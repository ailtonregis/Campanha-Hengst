const { ensureSchema } = require('./_database');
const { isAuthenticated } = require('./_auth');

const PROJECT_ID = 'campanha-hengst';

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!isAuthenticated(req)) return res.status(401).json({ error: 'Sessão administrativa inválida ou expirada.' });
  try {
    const sql = await ensureSchema();
    if (req.method === 'GET') {
      const rows = await sql`
        select id, origin, period_start::text as period_start, period_end::text as period_end,
               record_count, valid_count, discarded_count, total_value::float8 as total_value,
               total_quantity::float8 as total_quantity, duration_ms, result, message,
               snapshot_id, metadata, created_by, created_at::text as created_at
        from campaign_update_history
        where project_id = ${PROJECT_ID}
        order by created_at desc
        limit 100
      `;
      return res.status(200).json({ history: rows });
    }
    if (req.method === 'POST') {
      const entry = req.body || {};
      const inserted = await sql`
        insert into campaign_update_history
          (project_id, origin, period_start, period_end, record_count, valid_count, discarded_count,
           total_value, total_quantity, duration_ms, result, message, snapshot_id, metadata)
        values
          (${PROJECT_ID}, ${String(entry.origin || 'MANUAL').slice(0, 40)},
           ${entry.periodStart || null}, ${entry.periodEnd || null},
           ${Math.max(0, Number(entry.recordCount || 0))}, ${Math.max(0, Number(entry.validCount || 0))},
           ${Math.max(0, Number(entry.discardedCount || 0))}, ${Number(entry.totalValue || 0)},
           ${Number(entry.totalQuantity || 0)}, ${Math.max(0, Number(entry.durationMs || 0))},
           ${entry.result === 'error' ? 'error' : 'success'}, ${String(entry.message || '').slice(0, 1000)},
           ${entry.snapshotId ? Number(entry.snapshotId) : null},
           ${sql.json(entry.metadata && typeof entry.metadata === 'object' ? entry.metadata : {})})
        returning id, created_at::text as created_at
      `;
      return res.status(201).json({ ok: true, entry: inserted[0] });
    }
    if (req.method === 'DELETE') {
      const id = Number(req.query?.id || 0);
      if (id) await sql`delete from campaign_update_history where id = ${id} and project_id = ${PROJECT_ID}`;
      else await sql`delete from campaign_update_history where project_id = ${PROJECT_ID} and created_at < now() - interval '180 days'`;
      return res.status(200).json({ ok: true });
    }
    res.setHeader('Allow', 'GET, POST, DELETE');
    return res.status(405).json({ error: 'Método não permitido.' });
  } catch (error) {
    console.error('Falha na API de histórico:', error);
    return res.status(500).json({ error: 'Não foi possível acessar o histórico compartilhado.' });
  }
};
