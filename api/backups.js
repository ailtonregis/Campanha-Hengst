const crypto = require('crypto');
const { ensureSchema } = require('./_database');
const { isAuthenticated } = require('./_auth');

const PROJECT_ID = 'campanha-hengst';
const MAX_STATE_BYTES = 4 * 1024 * 1024;
const MAX_SNAPSHOTS = 20;

function checksum(state) {
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(state)).digest('hex')}`;
}

function validState(state) {
  return state && typeof state === 'object' && !Array.isArray(state)
    && Array.isArray(state.rawRows)
    && (!state.historicalRows || Array.isArray(state.historicalRows));
}

function validateState(state) {
  if (!validState(state)) throw new Error('O backup não contém um estado válido do Painel Hengst.');
  if (state.rawRows.length > 50000 || (state.historicalRows?.length || 0) > 50000) {
    throw new Error('O backup excede o limite de 50.000 registros por base.');
  }
  for (const row of [...state.rawRows, ...(state.historicalRows || [])]) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new Error('O backup contém uma linha inválida.');
    if (!Number.isFinite(Number(row.quantidade || 0)) || !Number.isFinite(Number(row.valor || 0))) {
      throw new Error('O backup contém quantidade ou valor inválido.');
    }
  }
  for (const key of ['vendorPhotos', 'sellerGoals', 'campaignSettings', 'cardDisplaySettings', 'tvSettings']) {
    if (state[key] != null && (typeof state[key] !== 'object' || Array.isArray(state[key]))) {
      throw new Error(`O campo ${key} do backup é inválido.`);
    }
  }
  if (Buffer.byteLength(JSON.stringify(state), 'utf8') > MAX_STATE_BYTES) {
    throw new Error('O backup ultrapassa o limite de 4 MB.');
  }
}

function backupEnvelope(state, createdAt = new Date().toISOString(), source = 'network-snapshot') {
  return {
    type: 'hengst-panel-backup',
    version: 1,
    createdAt,
    source,
    checksum: checksum(state),
    data: state
  };
}

async function trimSnapshots(sql) {
  await sql`
    delete from campaign_project_snapshots
    where project_id = ${PROJECT_ID}
      and id not in (
        select id from campaign_project_snapshots
        where project_id = ${PROJECT_ID}
        order by created_at desc
        limit ${MAX_SNAPSHOTS}
      )
  `;
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!isAuthenticated(req)) return res.status(401).json({ error: 'Sessão administrativa inválida ou expirada.' });

  try {
    const sql = await ensureSchema();

    if (req.method === 'GET') {
      const id = Number(req.query?.id || 0);
      if (id) {
        const rows = await sql`
          select id, reason, state, metadata, created_at::text as created_at
          from campaign_project_snapshots
          where id = ${id} and project_id = ${PROJECT_ID}
          limit 1
        `;
        if (!rows[0]) return res.status(404).json({ error: 'Snapshot não encontrado.' });
        return res.status(200).json({
          id: rows[0].id,
          reason: rows[0].reason,
          metadata: rows[0].metadata,
          backup: backupEnvelope(rows[0].state, rows[0].created_at, 'network-snapshot')
        });
      }
      const rows = await sql`
        select id, reason, metadata, created_by, created_at::text as created_at,
               octet_length(state::text) as size_bytes
        from campaign_project_snapshots
        where project_id = ${PROJECT_ID}
        order by created_at desc
        limit ${MAX_SNAPSHOTS}
      `;
      return res.status(200).json({ snapshots: rows });
    }

    if (req.method === 'POST') {
      const action = String(req.body?.action || 'snapshot');

      if (action === 'snapshot') {
        const reason = String(req.body?.reason || 'manual').slice(0, 120);
        const metadata = req.body?.metadata && typeof req.body.metadata === 'object' ? req.body.metadata : {};
        const current = await sql`
          select state from campaign_project_state where id = ${PROJECT_ID} limit 1
        `;
        if (!current[0]) return res.status(404).json({ error: 'Ainda não existe um estado do projeto para proteger.' });
        const inserted = await sql`
          insert into campaign_project_snapshots (project_id, reason, state, metadata)
          values (${PROJECT_ID}, ${reason}, ${sql.json(current[0].state)}, ${sql.json(metadata)})
          returning id, created_at::text as created_at
        `;
        await trimSnapshots(sql);
        return res.status(201).json({ ok: true, snapshot: inserted[0] });
      }

      if (action === 'import' || action === 'restore') {
        let replacement;
        let reason;
        if (action === 'import') {
          const backup = req.body?.backup;
          if (!backup || backup.type !== 'hengst-panel-backup' || Number(backup.version) !== 1) {
            return res.status(400).json({ error: 'Formato ou versão do backup inválidos.' });
          }
          replacement = backup.data;
          validateState(replacement);
          if (backup.checksum && backup.checksum !== checksum(replacement)) {
            return res.status(400).json({ error: 'O checksum do backup não confere. O arquivo pode estar corrompido.' });
          }
          reason = 'before_backup_import';
        } else {
          const snapshotId = Number(req.body?.snapshotId || 0);
          const target = await sql`
            select state from campaign_project_snapshots
            where id = ${snapshotId} and project_id = ${PROJECT_ID}
            limit 1
          `;
          if (!target[0]) return res.status(404).json({ error: 'Snapshot solicitado não foi encontrado.' });
          replacement = target[0].state;
          validateState(replacement);
          reason = `before_snapshot_restore_${snapshotId}`;
        }

        const expectedUpdatedAt = String(req.body?.expectedUpdatedAt || '');
        const result = await sql.begin(async transaction => {
          const current = await transaction`
            select state, updated_at::text as updated_at
            from campaign_project_state where id = ${PROJECT_ID} for update
          `;
          if (!current[0]) throw new Error('Estado atual do projeto não encontrado.');
          if (!expectedUpdatedAt || current[0].updated_at !== expectedUpdatedAt) {
            const conflict = new Error('Os dados foram atualizados por outro dispositivo. Recarregue antes de restaurar.');
            conflict.statusCode = 409;
            throw conflict;
          }
          const protectedRows = await transaction`
            insert into campaign_project_snapshots (project_id, reason, state, metadata)
            values (${PROJECT_ID}, ${reason}, ${transaction.json(current[0].state)}, ${transaction.json({ automatic: true })})
            returning id
          `;
          const updated = await transaction`
            update campaign_project_state
            set state = ${transaction.json(replacement)}, updated_at = now()
            where id = ${PROJECT_ID}
            returning updated_at::text as updated_at
          `;
          await transaction`
            insert into campaign_update_history
              (project_id, origin, record_count, valid_count, total_value, total_quantity, result, message, snapshot_id, metadata)
            values
              (${PROJECT_ID}, ${action === 'import' ? 'BACKUP' : 'SNAPSHOT'},
               ${replacement.rawRows.length}, ${replacement.rawRows.length},
               ${replacement.rawRows.reduce((sum, row) => sum + Number(row.valor || 0), 0)},
               ${replacement.rawRows.reduce((sum, row) => sum + Number(row.quantidade || 0), 0)},
               'success', ${action === 'import' ? 'Backup importado.' : 'Snapshot restaurado.'},
               ${protectedRows[0].id}, ${transaction.json({ action })})
          `;
          return { updatedAt: updated[0].updated_at, protectedSnapshotId: protectedRows[0].id };
        });
        await trimSnapshots(sql);
        return res.status(200).json({ ok: true, state: replacement, ...result });
      }

      return res.status(400).json({ error: 'Ação de backup não reconhecida.' });
    }

    if (req.method === 'DELETE') {
      const id = Number(req.query?.id || 0);
      if (!id) return res.status(400).json({ error: 'Informe o snapshot que será removido.' });
      await sql`delete from campaign_project_snapshots where id = ${id} and project_id = ${PROJECT_ID}`;
      return res.status(200).json({ ok: true });
    }

    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Método não permitido.' });
  } catch (error) {
    console.error('Falha na API de backups:', error);
    return res.status(error.statusCode || 500).json({ error: error.statusCode ? error.message : 'Não foi possível concluir a operação de backup.' });
  }
};
