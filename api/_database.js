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
    await database`
      create table if not exists campaign_project_snapshots (
        id bigserial primary key,
        project_id text not null,
        reason text not null,
        state jsonb not null,
        metadata jsonb not null default '{}'::jsonb,
        created_by text not null default 'admin',
        created_at timestamptz not null default now()
      )
    `;
    await database`
      create index if not exists campaign_project_snapshots_project_created_idx
      on campaign_project_snapshots (project_id, created_at desc)
    `;
    await database`
      create table if not exists campaign_update_history (
        id bigserial primary key,
        project_id text not null,
        origin text not null,
        period_start date,
        period_end date,
        record_count integer not null default 0,
        valid_count integer not null default 0,
        discarded_count integer not null default 0,
        total_value numeric not null default 0,
        total_quantity numeric not null default 0,
        duration_ms integer not null default 0,
        result text not null,
        message text not null default '',
        snapshot_id bigint references campaign_project_snapshots(id) on delete set null,
        metadata jsonb not null default '{}'::jsonb,
        created_by text not null default 'admin',
        created_at timestamptz not null default now()
      )
    `;
    await database`
      create index if not exists campaign_update_history_project_created_idx
      on campaign_update_history (project_id, created_at desc)
    `;
    initialized = true;
  }
  return database;
}

module.exports = { ensureSchema };
