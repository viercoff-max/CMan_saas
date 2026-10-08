// Cross-conversation abuse limits (security review H1, M6). Tenant-scoped, stores only HMAC hashes (never the
// order number or email). Tables are created lazily here because db.ts/store.ts are shared files.
//
// 1. Order lookups: failed lookups are counted per HMAC(order number), per HMAC(email) and per tenant over the last
//    hour. Past a threshold the engine answers with the generic not-found text + a human offer WITHOUT calling the
//    connector, so new conversations / new sender ids do not buy new guesses.
// 2. Inbound throttle: messages per conversation over a short window, to cap LLM cost and queue flooding.
import { createHmac, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { getDb } from "../db";

export const LOOKUP_WINDOW_MS = 60 * 60 * 1000;
export const MAX_FAILS_PER_ORDER = 5;
export const MAX_FAILS_PER_EMAIL = 5;
export const MAX_FAILS_PER_TENANT = 60;

export const INBOUND_WINDOW_MS = 10 * 60 * 1000;
export const MAX_INBOUND_PER_WINDOW = 20;

const RETENTION_MS = 24 * 60 * 60 * 1000;

const ready = new WeakSet<DatabaseSync>();
function db(): DatabaseSync {
  const d = getDb();
  if (!ready.has(d)) {
    d.exec(`
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
    `);
    ready.add(d);
  }
  return d;
}

let fallbackSecret: string | null = null;
function secret(): string {
  const s = process.env.APP_SECRET;
  if (s && s.length >= 16) return s;
  // Tests / misconfigured dev only: a per-process random key (limits then reset on restart).
  if (!fallbackSecret) {
    fallbackSecret = randomBytes(32).toString("hex");
    console.warn("[limiter] APP_SECRET missing: using a per-process key for lookup limits");
  }
  return fallbackSecret;
}

export const normOrder = (n: string) => String(n ?? "").replace(/[#\s]/g, "").toUpperCase();
export const normEmail = (e: string) => String(e ?? "").trim().toLowerCase();

/** HMAC(APP_SECRET, tenant|kind|value), hex. Never store or log the raw value. */
export function keyHash(tenantId: string, kind: "order" | "email", value: string): string {
  return createHmac("sha256", secret()).update(`${tenantId}|${kind}|${value}`).digest("hex");
}

const count = (sql: string, ...args: (string | number)[]) =>
  Number((db().prepare(sql).get(...args) as { n: number } | undefined)?.n ?? 0);

/** True when this lookup must NOT reach the connector (too many recent failures for that order, email or tenant). */
export function isLookupBlocked(tenantId: string, orderNumber: string, email: string, now: number): boolean {
  const since = now - LOOKUP_WINDOW_MS;
  if (count("SELECT COUNT(*) AS n FROM engine_lookup_failures WHERE tenant_id=? AND at>?", tenantId, since) >= MAX_FAILS_PER_TENANT) return true;
  const oh = keyHash(tenantId, "order", normOrder(orderNumber));
  if (count("SELECT COUNT(*) AS n FROM engine_lookup_failures WHERE tenant_id=? AND order_hash=? AND at>?", tenantId, oh, since) >= MAX_FAILS_PER_ORDER) return true;
  const eh = keyHash(tenantId, "email", normEmail(email));
  return count("SELECT COUNT(*) AS n FROM engine_lookup_failures WHERE tenant_id=? AND email_hash=? AND at>?", tenantId, eh, since) >= MAX_FAILS_PER_EMAIL;
}

/** Records one failed lookup (not found, email mismatch or missing email: all the same). */
export function recordLookupFailure(tenantId: string, orderNumber: string, email: string, now: number): void {
  const d = db();
  d.prepare("INSERT INTO engine_lookup_failures (tenant_id, order_hash, email_hash, at) VALUES (?,?,?,?)")
    .run(tenantId, keyHash(tenantId, "order", normOrder(orderNumber)), keyHash(tenantId, "email", normEmail(email)), now);
  d.prepare("DELETE FROM engine_lookup_failures WHERE tenant_id=? AND at<?").run(tenantId, now - RETENTION_MS);
}

/** Logs one inbound message for the conversation and returns how many arrived within the window (including this one). */
export function recordInbound(tenantId: string, conversationId: string, now: number): number {
  const d = db();
  d.prepare("INSERT INTO engine_inbound_log (tenant_id, conversation_id, at) VALUES (?,?,?)").run(tenantId, conversationId, now);
  d.prepare("DELETE FROM engine_inbound_log WHERE tenant_id=? AND conversation_id=? AND at<?").run(tenantId, conversationId, now - RETENTION_MS);
  return count("SELECT COUNT(*) AS n FROM engine_inbound_log WHERE tenant_id=? AND conversation_id=? AND at>?", tenantId, conversationId, now - INBOUND_WINDOW_MS);
}
