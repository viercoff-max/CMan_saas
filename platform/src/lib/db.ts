// SQLite (node:sqlite, built into Node 24) for the on-prem build.
// PROD NOTE: all SQL lives in src/lib/store.ts and per-module repos that call getDb().
// To move to Supabase/Postgres, replace this file and those repos; keep tenant_id on every table.
import { DatabaseSync } from "node:sqlite";
import fs from "node:fs";
import path from "node:path";

/** Runtime data folder. In production keep it OUT of OneDrive (see docs/RUNBOOK.md), e.g. C:\ProgramData\SocialInbox\data. */
export const DATA_DIR = process.env.DATA_DIR?.trim() || path.join(process.cwd(), "data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
/** Where handoff notifications should be written (retention purges it). */
export const OUTBOX_DIR = path.join(DATA_DIR, "outbox");

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL, password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'admin',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS agent_settings (
  tenant_id TEXT PRIMARY KEY, agent_name TEXT NOT NULL DEFAULT 'Asistente',
  tone_level INTEGER NOT NULL DEFAULT 3,
  language_default TEXT NOT NULL DEFAULT 'es', language_alt TEXT NOT NULL DEFAULT 'en',
  greeting TEXT NOT NULL DEFAULT '', fallback_message TEXT NOT NULL DEFAULT '',
  handoff_email TEXT NOT NULL DEFAULT '',
  business_hours TEXT NOT NULL DEFAULT '{}',
  cross_sell_level INTEGER NOT NULL DEFAULT 1,
  bot_enabled INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS context_sections (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, key TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(tenant_id, key)
);
CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, kind TEXT NOT NULL,
  title TEXT NOT NULL, url TEXT, file_path TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  error TEXT, content_text TEXT, last_synced_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, source_id TEXT, section_key TEXT,
  title TEXT NOT NULL DEFAULT '', text TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chunks_tenant ON chunks(tenant_id);
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  external_id TEXT NOT NULL, customer_name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'bot',
  escalation_reason TEXT, state TEXT NOT NULL DEFAULT '{}',
  last_message_at TEXT NOT NULL DEFAULT (datetime('now')),
  unread INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(tenant_id, channel, external_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, tenant_id TEXT NOT NULL,
  direction TEXT NOT NULL,
  sender TEXT NOT NULL,
  body TEXT NOT NULL, meta TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_msg_conv ON messages(conversation_id, created_at);
CREATE TABLE IF NOT EXISTS addons (
  tenant_id TEXT NOT NULL, key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disconnected',
  config_enc TEXT,
  public_info TEXT NOT NULL DEFAULT '{}',
  connected_at TEXT, PRIMARY KEY (tenant_id, key)
);
CREATE TABLE IF NOT EXISTS channel_accounts (
  tenant_id TEXT NOT NULL, channel TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'disconnected',
  config_enc TEXT, public_info TEXT NOT NULL DEFAULT '{}', PRIMARY KEY (tenant_id, channel)
);
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, actor TEXT NOT NULL, action TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
`;

// Extra indexes. Each runs on its own so one failure (e.g. pre-existing duplicate channel IDs) never blocks startup.
const INDEXES: { name: string; sql: string }[] = [
  // Tenant-scoped message reads (listMessages) and the retention purge.
  { name: "idx_msg_tenant_conv", sql: "CREATE INDEX IF NOT EXISTS idx_msg_tenant_conv ON messages(tenant_id, conversation_id, created_at)" },
  { name: "idx_msg_tenant_created", sql: "CREATE INDEX IF NOT EXISTS idx_msg_tenant_created ON messages(tenant_id, created_at)" },
  // Inbound dedupe by Meta message id (engine/repo.ts).
  { name: "idx_msg_provider", sql: "CREATE INDEX IF NOT EXISTS idx_msg_provider ON messages(tenant_id, json_extract(meta, '$.providerMessageId'))" },
  // Inbox list + retention purge.
  { name: "idx_conv_tenant_last", sql: "CREATE INDEX IF NOT EXISTS idx_conv_tenant_last ON conversations(tenant_id, last_message_at)" },
  { name: "idx_audit_tenant", sql: "CREATE INDEX IF NOT EXISTS idx_audit_tenant ON audit_log(tenant_id, created_at)" },
  // M7: two tenants can never both have the same CONNECTED Page / IG / WhatsApp id.
  // saveChannelAccount throws "UNIQUE constraint failed" if another tenant already owns it (callers should catch it).
  {
    name: "uq_channel_external",
    sql: `CREATE UNIQUE INDEX IF NOT EXISTS uq_channel_external ON channel_accounts(channel, json_extract(public_info, '$.externalId'))
          WHERE status = 'connected' AND json_extract(public_info, '$.externalId') IS NOT NULL AND json_extract(public_info, '$.externalId') <> ''`,
  },
];

/** Adds a column only when PRAGMA table_info says it is missing (safe to run on every start). */
function addColumnIfMissing(db: DatabaseSync, table: string, column: string, ddl: string): void {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  if (cols.some((c) => c.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

/**
 * Additive, idempotent migrations for databases created by older builds. Never drops or rewrites data.
 * - context_sections.mode ('text' | 'file') + file_source_id (the section's file is a normal `sources` row).
 * - section_sources: Data sources linked to a context section ("Complementar con fuentes de datos").
 */
export function runMigrations(db: DatabaseSync): void {
  const steps: [string, () => void][] = [
    ["context_sections.mode", () => addColumnIfMissing(db, "context_sections", "mode", "mode TEXT NOT NULL DEFAULT 'text'")],
    ["context_sections.file_source_id", () => addColumnIfMissing(db, "context_sections", "file_source_id", "file_source_id TEXT")],
    ["section_sources", () => db.exec(`
      CREATE TABLE IF NOT EXISTS section_sources (
        tenant_id TEXT NOT NULL, section_key TEXT NOT NULL, source_id TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (tenant_id, section_key, source_id)
      );
      CREATE INDEX IF NOT EXISTS idx_section_sources_source ON section_sources(tenant_id, source_id);
    `)],
  ];
  for (const [name, run] of steps) {
    try { run(); } catch (e) { console.warn(`[db] migration ${name} failed:`, e instanceof Error ? e.message : "error"); }
  }
}

declare global {
  // eslint-disable-next-line no-var
  var __db: DatabaseSync | undefined;
}

export function getDb(): DatabaseSync {
  if (!globalThis.__db) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const db = new DatabaseSync(path.join(DATA_DIR, "app.db"));
    db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    db.exec(SCHEMA);
    runMigrations(db);
    for (const ix of INDEXES) {
      try { db.exec(ix.sql); } catch { console.warn(`[db] could not create index ${ix.name} (existing data conflicts?)`); }
    }
    globalThis.__db = db;
  }
  return globalThis.__db;
}
