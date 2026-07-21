const postgres = require('postgres');

let sql;
let initialized = false;

function getDatabase() {
  if (!process.env.POSTGRES_URL) {
    throw new Error('POSTGRES_URL não foi configurada pela integração do Supabase.');
  }

  if (!sql) {
    sql = postgres(process.env.POSTGRES_URL, {
      max: 1,
      idle_timeout: 10,
      max_lifetime: 60,
      connect_timeout: 10,
      prepare: false,
      ssl: 'require'
    });
  }

  return sql;
}

async function ensureSchema() {
  const database = getDatabase();
  if (!initialized) {
    const [schema] = await database`
      select to_regclass('public.campaign_project_state') as table_name
    `;
    if (!schema?.table_name) {
      await database`
        create table campaign_project_state (
          id text primary key,
          state jsonb not null default '{}'::jsonb,
          updated_at timestamptz not null default now()
        )
      `;
    }
    initialized = true;
  }
  return database;
}

module.exports = { ensureSchema };
