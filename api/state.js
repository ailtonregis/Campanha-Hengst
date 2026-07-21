const { ensureSchema } = require('./_database');
const { isAuthenticated } = require('./_auth');

const PROJECT_ID = 'campanha-hengst';
const MAX_STATE_BYTES = 4 * 1024 * 1024;

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  try {
    const sql = await ensureSchema();

    if (req.method === 'GET') {
      const rows = await sql`
        select state, updated_at
        from campaign_project_state
        where id = ${PROJECT_ID}
        limit 1
      `;
      return res.status(200).json(rows[0]
        ? { state: rows[0].state, updatedAt: rows[0].updated_at }
        : { state: null, updatedAt: null });
    }

    if (req.method === 'PUT') {
      if (!isAuthenticated(req)) return res.status(401).json({ error: 'Sessão administrativa inválida ou expirada.' });
      const state = req.body?.state;
      if (!state || typeof state !== 'object' || Array.isArray(state)) {
        return res.status(400).json({ error: 'Estado do projeto inválido.' });
      }
      if (Buffer.byteLength(JSON.stringify(state), 'utf8') > MAX_STATE_BYTES) {
        return res.status(413).json({ error: 'Os dados ultrapassaram o limite de 4 MB por sincronização.' });
      }

      const rows = await sql`
        insert into campaign_project_state (id, state, updated_at)
        values (${PROJECT_ID}, ${sql.json(state)}, now())
        on conflict (id) do update
        set state = excluded.state, updated_at = excluded.updated_at
        returning updated_at
      `;
      return res.status(200).json({ ok: true, updatedAt: rows[0].updated_at });
    }

    res.setHeader('Allow', 'GET, PUT');
    return res.status(405).json({ error: 'Método não permitido.' });
  } catch (error) {
    console.error('Falha na API de estado:', error);
    return res.status(500).json({ error: 'Não foi possível acessar o armazenamento em nuvem.' });
  }
};
