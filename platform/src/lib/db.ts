// SQLite (node:sqlite, built into Node 24) for the on-prem build: connection, schema and additive migrations.
// All SQL lives in the SQLite DataStore (src/lib/data/sqlite/**). App code goes through getData() (src/lib/data),
// never through getDb(): a test (src/lib/data/__tests__/boundary.test.ts) enforces it.
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/** Runtime data folder. In production keep it OUT of OneDrive (see docs/RUNBOOK.md), e.g. C:\ProgramData\SocialInbox\data. */
export const DATA_DIR = process.env.DATA_DIR?.trim() || path.join(process.cwd(), "data");
export const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
/** Local twin of the public "brand-assets" Storage bucket (logos), served by /api/brand-assets/... */
export const BRAND_ASSETS_DIR = path.join(DATA_DIR, "brand-assets");
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
  // getData().channels.save turns the "UNIQUE constraint failed" error into DataConflictError (callers catch it).
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
 * - engine limiter + login/rate-limit tables (formerly created lazily by their modules).
 * - brand_settings and ai_usage (same shape as the Supabase schema in supabase/migrations).
 * - tenants.slug / plan / status / ai_monthly_token_cap (wave 1: same defaults as public.tenants).
 * - channel_accounts.webhook_id: public random routing id (Telegram webhook URL), backfilled, unique.
 * - conversations.legal_hold: sticky legal hold (safety/legal escalations), backfilled once.
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
    ["engine_limiter", () => db.exec(`
      CREATE TABLE IF NOT EXISTS engine_lookup_failures (
        tenant_id TEXT NOT NULL, order_hash TEXT NOT NULL, email_hash TEXT NOT NULL, at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_elf_tenant_at ON engine_lookup_failures(tenant_id, at);
      CREATE INDEX IF NOT EXISTS idx_elf_order ON engine_lookup_failures(tenant_id, order_hash, at);
      CREATE INDEX IF NOT EXISTS idx_elf_email ON engine_lookup_failures(tenant_id, email_hash, at);
      CREATE TABLE IF NOT EXISTS engine_inbound_log (
        tenant_id TEXT NOT NULL, conversation_id TEXT NOT NULL, at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_eil_conv ON engine_inbound_log(tenant_id, conversation_id, at);
    `)],
    ["rate_limits", () => db.exec(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS login_attempts (
        key TEXT NOT NULL, at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts(key, at);
    `)],
    ["brand_settings", () => db.exec(`
      CREATE TABLE IF NOT EXISTS brand_settings (
        tenant_id TEXT PRIMARY KEY, display_name TEXT NOT NULL DEFAULT '', logo_path TEXT,
        primary_color TEXT NOT NULL DEFAULT '#0F766E', accent_color TEXT NOT NULL DEFAULT '#14181F',
        menu_bg_color TEXT NOT NULL DEFAULT '#F6F7F9', heading_font TEXT NOT NULL DEFAULT 'system',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `)],
    ["ai_usage", () => db.exec(`
      CREATE TABLE IF NOT EXISTS ai_usage (
        tenant_id TEXT NOT NULL, period TEXT NOT NULL,
        requests INTEGER NOT NULL DEFAULT 0, input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL DEFAULT (datetime('now')),
        PRIMARY KEY (tenant_id, period)
      );
    `)],
    ["tenants.slug", () => addColumnIfMissing(db, "tenants", "slug", "slug TEXT")],
    ["tenants.plan", () => addColumnIfMissing(db, "tenants", "plan", "plan TEXT NOT NULL DEFAULT 'free'")],
    ["tenants.status", () => addColumnIfMissing(db, "tenants", "status", "status TEXT NOT NULL DEFAULT 'active'")],
    ["tenants.ai_monthly_token_cap", () => addColumnIfMissing(db, "tenants", "ai_monthly_token_cap", "ai_monthly_token_cap INTEGER NOT NULL DEFAULT 2000000")],
    ["channel_accounts.webhook_id", () => {
      addColumnIfMissing(db, "channel_accounts", "webhook_id", "webhook_id TEXT");
      const missing = db.prepare("SELECT tenant_id, channel FROM channel_accounts WHERE webhook_id IS NULL").all() as { tenant_id: string; channel: string }[];
      const set = db.prepare("UPDATE channel_accounts SET webhook_id = ? WHERE tenant_id = ? AND channel = ? AND webhook_id IS NULL");
      for (const r of missing) set.run(randomUUID(), r.tenant_id, r.channel);
      db.exec("CREATE UNIQUE INDEX IF NOT EXISTS uq_channel_webhook_id ON channel_accounts(webhook_id) WHERE webhook_id IS NOT NULL");
    }],
    // H1 (REVIEW-security-2): sticky legal hold, same as public.conversations.legal_hold. Set when a conversation is
    // escalated for safety/legal and never cleared by app code. Backfilled ONCE, when the column is created, from the
    // escalation reason, state.legalHold and the engine's escalation_safety / escalation_legal message intents (this
    // also catches conversations that were already resolved, whose reason had been cleared).
    ["conversations.legal_hold", () => {
      const had = (db.prepare("PRAGMA table_info(conversations)").all() as { name: string }[]).some((c) => c.name === "legal_hold");
      if (had) return;
      db.exec("ALTER TABLE conversations ADD COLUMN legal_hold INTEGER NOT NULL DEFAULT 0");
      db.exec(`UPDATE conversations SET legal_hold = 1 WHERE legal_hold = 0 AND (
        COALESCE(escalation_reason, '') IN ('safety', 'legal')
        OR COALESCE(CASE WHEN json_valid(state) THEN json_extract(state, '$.legalHold') END, 0) IN (1, 'true', '1')
        OR EXISTS (SELECT 1 FROM messages m WHERE m.tenant_id = conversations.tenant_id AND m.conversation_id = conversations.id
                   AND json_valid(m.meta) AND json_extract(m.meta, '$.intent') IN ('escalation_safety', 'escalation_legal')))`);
    }],
    // Phase 1 "atención en equipo" (same shape as supabase/migrations/20261122120000_team_inbox.sql). Notes and
    // events cascade with their conversation (PRAGMA foreign_keys = ON).
    ["conversations.assigned_to", () => addColumnIfMissing(db, "conversations", "assigned_to", "assigned_to TEXT")],
    ["conversations.customer_id", () => addColumnIfMissing(db, "conversations", "customer_id", "customer_id TEXT")],
    ["team_inbox", () => db.exec(`
      CREATE TABLE IF NOT EXISTS customers (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, name TEXT NOT NULL DEFAULT '', email TEXT, phone TEXT,
        tags TEXT NOT NULL DEFAULT '[]', notes TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_customers_tenant ON customers(tenant_id, updated_at);
      CREATE INDEX IF NOT EXISTS idx_conv_tenant_customer ON conversations(tenant_id, customer_id);
      CREATE TABLE IF NOT EXISTS conversation_notes (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        author_user_id TEXT, body TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_notes_conv ON conversation_notes(tenant_id, conversation_id, created_at);
      CREATE TABLE IF NOT EXISTS conversation_events (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        actor_user_id TEXT, kind TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_events_conv ON conversation_events(tenant_id, conversation_id, created_at);
    `)],
    ["push_notifications", () => db.exec(`
      CREATE TABLE IF NOT EXISTS push_subscriptions (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, endpoint TEXT NOT NULL UNIQUE,
        user_agent TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), last_ok_at TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_push_subs_tenant_user ON push_subscriptions(tenant_id, user_id);
      CREATE TABLE IF NOT EXISTS notification_prefs (
        tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, waiting INTEGER NOT NULL DEFAULT 1, urgent INTEGER NOT NULL DEFAULT 1,
        assigned INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (tenant_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS notifications (
        id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL,
        body TEXT NOT NULL DEFAULT '', url TEXT NOT NULL DEFAULT '/inbox', created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, created_at);
    `)],
    ["dashboard_prefs", () => db.exec(`
      CREATE TABLE IF NOT EXISTS dashboard_prefs (
        tenant_id TEXT NOT NULL, user_id TEXT NOT NULL, cards TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (tenant_id, user_id)
      );
      CREATE INDEX IF NOT EXISTS idx_events_tenant_created ON conversation_events(tenant_id, created_at);
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
