// Data lifecycle (LFPDPPP / Meta / Shopify): retention purge, per-customer deletion (ARCO cancelación) and export (ARCO acceso).
// Run the purge daily: `npm run purge` (see docs/RUNBOOK.md). Audit rows carry counts and hashes only, never PII.
// NOTE: relative imports only (no "@/"), so the CLI scripts in scripts/ can load this file with Node's type stripping.
import fs from "node:fs";
import path from "node:path";
import { getDb, OUTBOX_DIR } from "../db";
import { audit } from "../store";
import { hashKey, purgeSecurityRows } from "../security/rate-limit";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Escalation reasons that put a conversation on legal hold (product liability / PROFECO). */
export const LEGAL_HOLD_REASONS = ["safety", "legal"] as const;
export const MASKED_BODY = "[contenido eliminado por política de retención]";

function intEnv(name: string, def: number, min: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.max(min, Math.floor(n)) : def;
}
/** Days to keep ordinary conversations. Owner rule: at least 1 month. Default 90. */
export const retentionDays = () => intEnv("RETENTION_DAYS", 90, 30);
/** Legal-hold conversations are kept, but their message bodies are masked after this many days. */
export const legalHoldMaskDays = () => intEnv("LEGAL_HOLD_MASK_DAYS", 365, 30);
/** Handoff e-mail files in the outbox. */
export const outboxRetentionDays = () => intEnv("OUTBOX_RETENTION_DAYS", 30, 1);

/** Outbox folders: DATA_DIR/outbox, plus the legacy process.cwd()/data/outbox used by older builds. */
export function outboxDirs(): string[] {
  return [...new Set([OUTBOX_DIR, path.join(process.cwd(), "data", "outbox")].map((d) => path.resolve(d)))];
}
function listOutbox(): string[] {
  const out: string[] = [];
  for (const dir of outboxDirs()) {
    let names: string[] = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) if (n.endsWith(".txt")) out.push(path.join(dir, n));
  }
  return out;
}
function rm(file: string): boolean {
  try { fs.unlinkSync(file); return true; } catch { return false; }
}
/** Delete outbox files that belong to a conversation (file name ends with -<convId>.txt, or the text mentions it). */
function deleteOutboxFor(convIds: string[], extraNeedles: string[] = []): number {
  if (!convIds.length && !extraNeedles.length) return 0;
  let n = 0;
  for (const f of listOutbox()) {
    const base = path.basename(f);
    let hit = convIds.some((id) => base.endsWith(`-${id}.txt`));
    if (!hit) {
      let text = "";
      try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
      hit = convIds.some((id) => text.includes(id)) || extraNeedles.some((s) => s.length >= 4 && text.includes(s));
    }
    if (hit && rm(f)) n++;
  }
  return n;
}

function tenantIds(): string[] {
  const rows = getDb().prepare("SELECT id FROM tenants UNION SELECT DISTINCT tenant_id AS id FROM conversations").all() as { id: string }[];
  return rows.map((r) => r.id);
}
// COALESCE everywhere: a NULL here would make "NOT hold" NULL and silently skip the row.
const HOLD_SQL = `(COALESCE(escalation_reason, '') IN ('safety','legal')
  OR COALESCE(CASE WHEN json_valid(state) THEN json_extract(state, '$.legalHold') END, 0) = 1)`;

export type PurgeResult = {
  tenants: number; messagesDeleted: number; conversationsDeleted: number; messagesMasked: number;
  outboxFilesDeleted: number; securityRowsDeleted: number; retentionDays: number;
};

/**
 * Delete messages/conversations older than RETENTION_DAYS (default 90), except legal-hold conversations
 * (escalated for safety or legal): those are kept, but message bodies older than LEGAL_HOLD_MASK_DAYS (365) are masked.
 * Also removes outbox files older than OUTBOX_RETENTION_DAYS (30) and expired login/rate-limit rows.
 * Without tenantId: every tenant + global folders/tables.
 */
export function purgeOldData(tenantId?: string, now: Date = new Date()): PurgeResult {
  const db = getDb();
  const days = retentionDays();
  const cutoff = new Date(now.getTime() - days * DAY_MS).toISOString();
  const maskCutoff = new Date(now.getTime() - legalHoldMaskDays() * DAY_MS).toISOString();
  const res: PurgeResult = { tenants: 0, messagesDeleted: 0, conversationsDeleted: 0, messagesMasked: 0, outboxFilesDeleted: 0, securityRowsDeleted: 0, retentionDays: days };

  for (const t of tenantId ? [tenantId] : tenantIds()) {
    res.tenants++;
    let msgs = 0, convs = 0, masked = 0;
    let goneConvIds: string[] = [];
    db.exec("BEGIN");
    try {
      // 1) Old messages in conversations without legal hold (julianday() copes with both ISO and SQLite datetime formats).
      msgs = Number(db.prepare(
        `DELETE FROM messages WHERE tenant_id = ? AND julianday(created_at) < julianday(?)
         AND conversation_id NOT IN (SELECT id FROM conversations WHERE tenant_id = ? AND ${HOLD_SQL})`,
      ).run(t, cutoff, t).changes);
      // 2) Conversations idle longer than the window (and their leftover messages).
      goneConvIds = (db.prepare(
        `SELECT id FROM conversations WHERE tenant_id = ? AND julianday(last_message_at) < julianday(?) AND NOT ${HOLD_SQL}`,
      ).all(t, cutoff) as { id: string }[]).map((r) => r.id);
      const delMsgs = db.prepare("DELETE FROM messages WHERE tenant_id = ? AND conversation_id = ?");
      const delConv = db.prepare("DELETE FROM conversations WHERE tenant_id = ? AND id = ?");
      for (const id of goneConvIds) {
        msgs += Number(delMsgs.run(t, id).changes);
        convs += Number(delConv.run(t, id).changes);
      }
      // 3) Legal hold: keep the record, mask the text after the hold-mask window.
      masked = Number(db.prepare(
        `UPDATE messages SET body = ?, meta = json_set(CASE WHEN json_valid(meta) THEN meta ELSE '{}' END, '$.masked', 1)
         WHERE tenant_id = ? AND body <> ? AND julianday(created_at) < julianday(?)
         AND conversation_id IN (SELECT id FROM conversations WHERE tenant_id = ? AND ${HOLD_SQL})`,
      ).run(MASKED_BODY, t, MASKED_BODY, maskCutoff, t).changes);
      db.exec("COMMIT");
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
    const files = deleteOutboxFor(goneConvIds);
    res.messagesDeleted += msgs; res.conversationsDeleted += convs; res.messagesMasked += masked; res.outboxFilesDeleted += files;
    if (msgs || convs || masked || files)
      audit(t, "system", "retention.purge", JSON.stringify({ days, messages: msgs, conversations: convs, masked, outbox: files }));
  }

  if (!tenantId) {
    const limit = now.getTime() - outboxRetentionDays() * DAY_MS;
    for (const f of listOutbox()) {
      try { if (fs.statSync(f).mtimeMs < limit && rm(f)) res.outboxFilesDeleted++; } catch { /* ignore */ }
    }
    res.securityRowsDeleted = purgeSecurityRows(now.getTime());
  }
  return res;
}

// ---------- per-customer rights (ARCO / Meta / Shopify) ----------
type ConvRow = {
  id: string; channel: string; external_id: string; customer_name: string; status: string;
  escalation_reason: string | null; state: string; created_at: string; last_message_at: string;
};
function findConversations(tenantId: string, channel: string, externalId: string): ConvRow[] {
  return getDb().prepare("SELECT * FROM conversations WHERE tenant_id = ? AND channel = ? AND external_id = ?")
    .all(tenantId, channel, externalId) as ConvRow[];
}
const isHeld = (c: ConvRow) => {
  if (c.escalation_reason && (LEGAL_HOLD_REASONS as readonly string[]).includes(c.escalation_reason)) return true;
  try { const h = JSON.parse(c.state || "{}").legalHold; return h === 1 || h === true; } catch { return false; }
};

export type DeleteResult = { conversations: number; messages: number; outboxFiles: number; heldConversations: number; ref: string };

/**
 * Delete everything stored about one customer identity (channel + external id: PSID / IG id / WhatsApp number).
 * Conversations on legal hold are NOT deleted unless `force` (report them as heldConversations so a person decides;
 * LFPDPPP allows keeping data needed for legal claims). Writes an audit row with a hashed reference only.
 */
export function deleteCustomerData(tenantId: string, channel: string, externalId: string, opts: { force?: boolean; actor?: string } = {}): DeleteResult {
  const db = getDb();
  const ref = hashKey("customer", `${tenantId}|${channel}|${externalId}`);
  const convs = findConversations(tenantId, channel, externalId);
  const held = convs.filter((c) => !opts.force && isHeld(c));
  const del = convs.filter((c) => opts.force || !isHeld(c));
  let messages = 0, conversations = 0;
  db.exec("BEGIN");
  try {
    for (const c of del) {
      messages += Number(db.prepare("DELETE FROM messages WHERE tenant_id = ? AND conversation_id = ?").run(tenantId, c.id).changes);
      conversations += Number(db.prepare("DELETE FROM conversations WHERE tenant_id = ? AND id = ?").run(tenantId, c.id).changes);
    }
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
  const outboxFiles = deleteOutboxFor(del.map((c) => c.id), del.length ? [externalId] : []);
  audit(tenantId, opts.actor ?? "system", "privacy.customer_deleted",
    JSON.stringify({ ref, channel, conversations, messages, outbox: outboxFiles, held: held.length, forced: !!opts.force }));
  return { conversations, messages, outboxFiles, heldConversations: held.length, ref };
}

export type CustomerExport = {
  exportedAt: string; tenantId: string; channel: string; externalId: string;
  conversations: {
    id: string; customerName: string; status: string; escalationReason: string | null; createdAt: string; lastMessageAt: string;
    messages: { direction: string; sender: string; body: string; createdAt: string }[];
  }[];
};

/** Everything we hold about one customer identity, as plain JSON (ARCO acceso / Shopify customers/data_request). */
export function exportCustomerData(tenantId: string, channel: string, externalId: string, opts: { actor?: string; now?: Date } = {}): CustomerExport {
  const db = getDb();
  const convs = findConversations(tenantId, channel, externalId);
  const out: CustomerExport = {
    exportedAt: (opts.now ?? new Date()).toISOString(), tenantId, channel, externalId,
    conversations: convs.map((c) => ({
      id: c.id, customerName: c.customer_name, status: c.status, escalationReason: c.escalation_reason,
      createdAt: c.created_at, lastMessageAt: c.last_message_at,
      messages: (db.prepare("SELECT direction, sender, body, created_at FROM messages WHERE tenant_id = ? AND conversation_id = ? ORDER BY created_at ASC")
        .all(tenantId, c.id) as { direction: string; sender: string; body: string; created_at: string }[])
        .map((m) => ({ direction: m.direction, sender: m.sender, body: m.body, createdAt: m.created_at })),
    })),
  };
  audit(tenantId, opts.actor ?? "system", "privacy.customer_exported",
    JSON.stringify({ ref: hashKey("customer", `${tenantId}|${channel}|${externalId}`), channel, conversations: convs.length }));
  return out;
}
