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
      idle_timeout: 20,
      connect_timeout: 15,
      ssl: 'require'
    });
  }

  return sql;
}

async function ensureSchema() {
  const database = getDatabase();
  if (!initialized) {
    await database`
      create table if not exists campaign_project_state (
        id text primary key,
        state jsonb not null default '{}'::jsonb,
        updated_at timestamptz not null default now()
      )
    `;
    initialized = true;
  }
  return database;
}

module.exports = { ensureSchema };
