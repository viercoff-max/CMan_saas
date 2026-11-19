// Data lifecycle (LFPDPPP / Meta / Shopify): retention purge, per-customer deletion (ARCO cancelación) and export (ARCO acceso).
// Run the purge daily: `npm run purge` (see docs/RUNBOOK.md). Audit rows carry counts and hashes only, never PII.
// NOTE: relative imports only (no "@/"), so the CLI scripts in scripts/ can load this file with Node's type stripping.
import fs from "node:fs";
import path from "node:path";
import { OUTBOX_DIR } from "../db";
import { getData } from "../data";
import type { CustomerConversation } from "../data/types";
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
export async function purgeOldData(tenantId?: string, now: Date = new Date()): Promise<PurgeResult> {
  const data = getData();
  const days = retentionDays();
  const cutoff = new Date(now.getTime() - days * DAY_MS).toISOString();
  const maskCutoff = new Date(now.getTime() - legalHoldMaskDays() * DAY_MS).toISOString();
  const res: PurgeResult = { tenants: 0, messagesDeleted: 0, conversationsDeleted: 0, messagesMasked: 0, outboxFilesDeleted: 0, securityRowsDeleted: 0, retentionDays: days };

  for (const t of tenantId ? [tenantId] : await data.retention.tenantIds()) {
    res.tenants++;
    const p = await data.retention.purgeTenant(t, { cutoff, maskCutoff, maskedBody: MASKED_BODY });
    const msgs = p.messagesDeleted, convs = p.conversationsDeleted, masked = p.messagesMasked;
    const files = deleteOutboxFor(p.deletedConversationIds);
    res.messagesDeleted += msgs; res.conversationsDeleted += convs; res.messagesMasked += masked; res.outboxFilesDeleted += files;
    if (msgs || convs || masked || files)
      await data.audit.log(t, "system", "retention.purge", JSON.stringify({ days, messages: msgs, conversations: convs, masked, outbox: files }));
  }

  if (!tenantId) {
    const limit = now.getTime() - outboxRetentionDays() * DAY_MS;
    for (const f of listOutbox()) {
      try { if (fs.statSync(f).mtimeMs < limit && rm(f)) res.outboxFilesDeleted++; } catch { /* ignore */ }
    }
    res.securityRowsDeleted = await purgeSecurityRows(now.getTime());
  }
  return res;
}

// ---------- per-customer rights (ARCO / Meta / Shopify) ----------
const isHeld = (c: CustomerConversation) => {
  if (c.escalationReason && (LEGAL_HOLD_REASONS as readonly string[]).includes(c.escalationReason)) return true;
  try { const h = JSON.parse(c.state || "{}").legalHold; return h === 1 || h === true; } catch { return false; }
};

export type DeleteResult = { conversations: number; messages: number; outboxFiles: number; heldConversations: number; ref: string };

/**
 * Delete everything stored about one customer identity (channel + external id: PSID / IG id / WhatsApp number).
 * Conversations on legal hold are NOT deleted unless `force` (report them as heldConversations so a person decides;
 * LFPDPPP allows keeping data needed for legal claims). Writes an audit row with a hashed reference only.
 */
export async function deleteCustomerData(tenantId: string, channel: string, externalId: string, opts: { force?: boolean; actor?: string } = {}): Promise<DeleteResult> {
  const data = getData();
  const ref = hashKey("customer", `${tenantId}|${channel}|${externalId}`);
  const convs = await data.retention.findCustomerConversations(tenantId, channel, externalId);
  const held = convs.filter((c) => !opts.force && isHeld(c));
  const del = convs.filter((c) => opts.force || !isHeld(c));
  const { messages, conversations } = await data.retention.deleteConversations(tenantId, del.map((c) => c.id));
  const outboxFiles = deleteOutboxFor(del.map((c) => c.id), del.length ? [externalId] : []);
  await data.audit.log(tenantId, opts.actor ?? "system", "privacy.customer_deleted",
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
export async function exportCustomerData(tenantId: string, channel: string, externalId: string, opts: { actor?: string; now?: Date } = {}): Promise<CustomerExport> {
  const data = getData();
  const convs = await data.retention.findCustomerConversations(tenantId, channel, externalId);
  const out: CustomerExport = {
    exportedAt: (opts.now ?? new Date()).toISOString(), tenantId, channel, externalId,
    conversations: await Promise.all(convs.map(async (c) => ({
      id: c.id, customerName: c.customerName, status: c.status, escalationReason: c.escalationReason,
      createdAt: c.createdAt, lastMessageAt: c.lastMessageAt,
      messages: await data.retention.exportMessages(tenantId, c.id),
    }))),
  };
  await data.audit.log(tenantId, opts.actor ?? "system", "privacy.customer_exported",
    JSON.stringify({ ref: hashKey("customer", `${tenantId}|${channel}|${externalId}`), channel, conversations: convs.length }));
  return out;
}
