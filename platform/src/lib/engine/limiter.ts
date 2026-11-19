// Cross-conversation abuse limits (security review H1, M6). Tenant-scoped, stores only HMAC hashes (never the
// order number or email). Storage: getData().limiter (src/lib/data).
//
// 1. Order lookups: failed lookups are counted per HMAC(order number), per HMAC(email) and per tenant over the last
//    hour. Past a threshold the engine answers with the generic not-found text + a human offer WITHOUT calling the
//    connector, so new conversations / new sender ids do not buy new guesses.
// 2. Inbound throttle: messages per conversation over a short window, to cap LLM cost and queue flooding.
import { createHmac, randomBytes } from "node:crypto";
import { getData } from "../data";

export const LOOKUP_WINDOW_MS = 60 * 60 * 1000;
export const MAX_FAILS_PER_ORDER = 5;
export const MAX_FAILS_PER_EMAIL = 5;
export const MAX_FAILS_PER_TENANT = 60;

export const INBOUND_WINDOW_MS = 10 * 60 * 1000;
export const MAX_INBOUND_PER_WINDOW = 20;

const RETENTION_MS = 24 * 60 * 60 * 1000;

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

/** True when this lookup must NOT reach the connector (too many recent failures for that order, email or tenant). */
export async function isLookupBlocked(tenantId: string, orderNumber: string, email: string, now: number): Promise<boolean> {
  const lim = getData().limiter;
  const since = now - LOOKUP_WINDOW_MS;
  if (await lim.countLookupFailures(tenantId, since) >= MAX_FAILS_PER_TENANT) return true;
  const orderHash = keyHash(tenantId, "order", normOrder(orderNumber));
  if (await lim.countLookupFailures(tenantId, since, { orderHash }) >= MAX_FAILS_PER_ORDER) return true;
  const emailHash = keyHash(tenantId, "email", normEmail(email));
  return await lim.countLookupFailures(tenantId, since, { emailHash }) >= MAX_FAILS_PER_EMAIL;
}

/** Records one failed lookup (not found, email mismatch or missing email: all the same). */
export async function recordLookupFailure(tenantId: string, orderNumber: string, email: string, now: number): Promise<void> {
  await getData().limiter.recordLookupFailure(
    tenantId, keyHash(tenantId, "order", normOrder(orderNumber)), keyHash(tenantId, "email", normEmail(email)), now, now - RETENTION_MS,
  );
}

/** Logs one inbound message for the conversation and returns how many arrived within the window (including this one). */
export async function recordInbound(tenantId: string, conversationId: string, now: number): Promise<number> {
  return getData().limiter.recordInbound(tenantId, conversationId, now, now - RETENTION_MS, now - INBOUND_WINDOW_MS);
}
