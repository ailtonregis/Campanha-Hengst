const { ensureSchema } = require('./_database');
const { isAuthenticated } = require('./_auth');

const PROJECT_ID = 'campanha-hengst';
const MAX_STATE_BYTES = 4 * 1024 * 1024;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const sql = await ensureSchema();

    if (req.method === 'HEAD') {
      const rows = await sql`
        select updated_at::text as updated_at
        from campaign_project_state
        where id = ${PROJECT_ID}
        limit 1
      `;
      if (rows[0]?.updated_at) res.setHeader('X-Project-Updated-At', rows[0].updated_at);
      return res.status(204).end();
    }

    if (req.method === 'GET') {
      const rows = await sql`
        select state, updated_at::text as updated_at
        from campaign_project_state
        where id = ${PROJECT_ID}
        limit 1
      `;
      return res.status(200).json(rows[0]
        ? {
            state: rows[0].state,
            updatedAt: rows[0].updated_at,
            exists: true,
            notModified: false
          }
        : { state: null, updatedAt: null, exists: false, notModified: false });
    }

    if (req.method === 'PUT') {
      if (!isAuthenticated(req)) return res.status(401).json({ error: 'Sessão administrativa inválida ou expirada.' });
      const state = req.body?.state;
      const expectedUpdatedAt = req.body?.expectedUpdatedAt;
      if (!state || typeof state !== 'object' || Array.isArray(state)) {
        return res.status(400).json({ error: 'Estado do projeto inválido.' });
      }
      if (Buffer.byteLength(JSON.stringify(state), 'utf8') > MAX_STATE_BYTES) {
        return res.status(413).json({ error: 'Os dados ultrapassaram o limite de 4 MB por sincronização.' });
      }

      const currentRows = await sql`
        select updated_at::text as updated_at
        from campaign_project_state
        where id = ${PROJECT_ID}
        limit 1
      `;
      let rows;
      if (currentRows[0]) {
        if (!expectedUpdatedAt || currentRows[0].updated_at !== expectedUpdatedAt) {
          return res.status(409).json({
            error: 'Os dados foram atualizados por outro dispositivo. Recarregue o painel antes de salvar.',
            updatedAt: currentRows[0].updated_at
          });
        }
        rows = await sql`
          update campaign_project_state
          set state = ${sql.json(state)}, updated_at = now()
          where id = ${PROJECT_ID}
            and updated_at::text = ${expectedUpdatedAt}
          returning updated_at::text as updated_at
        `;
        if (!rows.length) {
          return res.status(409).json({ error: 'Outro dispositivo atualizou os dados durante o salvamento. Recarregue o painel.' });
        }
      } else {
        rows = await sql`
          insert into campaign_project_state (id, state, updated_at)
          values (${PROJECT_ID}, ${sql.json(state)}, now())
          returning updated_at::text as updated_at
        `;
      }
      return res.status(200).json({ ok: true, updatedAt: rows[0].updated_at });
    }

    res.setHeader('Allow', 'GET, HEAD, PUT');
    return res.status(405).json({ error: 'Método não permitido.' });
  } catch (error) {
    console.error('Falha na API de estado:', error);
    return res.status(500).json({ error: 'Não foi possível acessar o armazenamento em nuvem.' });
  }
};
