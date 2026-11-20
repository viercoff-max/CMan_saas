// AI spend guards in front of every paid LLM call (security review 2, M3):
//
// 1. Platform-wide DAILY breaker (all tenants together): PLATFORM_DAILY_TOKEN_CAP tokens per UTC day (default 5,000,000;
//    "0" stops every paid call). There is no cross-tenant daily usage query in the data layer (ai_usage is monthly per
//    tenant), so the day total is kept by two counters:
//    - in-process: exact tokens used today + tokens reserved by calls still in flight (precise within one instance);
//    - shared: getData().rateLimits fixed-window counter keyed by the UTC day, in units of SPEND_UNIT_TOKENS, so every
//      instance sees the same total. Each call reserves ceil(estimate / unit) units BEFORE it runs and never refunds
//      them (conservative: the estimate is an upper bound: prompt estimate + max_tokens).
//    When the day is spent the engine answers with the free deterministic fallback (same path as the monthly cap).
// 2. Per-tenant reservation: the monthly budget must cover the call's upper bound (remaining - in-flight >= estimate),
//    not just "> 0", so parallel calls cannot overshoot the cap by much (at most what was in flight on other instances).
// Errors reading the shared counter fail CLOSED (no paid call; the customer still gets the deterministic answer).
import { getData } from "../data";

export const DEFAULT_PLATFORM_DAILY_TOKEN_CAP = 5_000_000;
export const SPEND_UNIT_TOKENS = 1_000;
const DAY_MS = 24 * 60 * 60 * 1000;

export function platformDailyCap(env: Record<string, string | undefined> = process.env): number {
  const raw = env.PLATFORM_DAILY_TOKEN_CAP?.trim().replace(/[_,]/g, "");
  if (!raw) return DEFAULT_PLATFORM_DAILY_TOKEN_CAP;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_PLATFORM_DAILY_TOKEN_CAP;
}

const utcDay = (now: Date) => now.toISOString().slice(0, 10);

// In-process day counters (one entry per UTC day; older days dropped).
const days = new Map<string, { used: number; reserved: number }>();
function dayEntry(day: string) {
  let e = days.get(day);
  if (!e) {
    for (const k of days.keys()) if (k < day) days.delete(k);
    e = { used: 0, reserved: 0 };
    days.set(day, e);
  }
  return e;
}
// In-process in-flight tokens per tenant (monthly budget reservation).
const tenantInFlight = new Map<string, number>();

export interface Reservation { tenantId: string; day: string; tokens: number; released: boolean }

export type ReserveResult =
  | { ok: true; reservation: Reservation }
  | { ok: false; reason: "tenant_cap" | "platform_cap" | "error" };

/**
 * Reserve `tokens` for one paid call: the tenant's monthly budget (`tenantRemaining`, read just before, minus what
 * this process already has in flight for the tenant) and today's platform budget. Call releaseReservation() with the
 * real usage afterwards (also on failure, with 0). The shared counter's units are never refunded.
 * The in-process checks and holds run synchronously before the first await, so parallel calls see each other.
 */
export async function reserveSpend(tenantId: string, tokens: number, tenantRemaining: number, now: Date, cap = platformDailyCap()): Promise<ReserveResult> {
  const day = utcDay(now);
  const e = dayEntry(day);
  if (tenantRemaining - inFlightTokens(tenantId) < tokens) return { ok: false, reason: "tenant_cap" };
  if (cap <= 0 || e.used + e.reserved + tokens > cap) return { ok: false, reason: "platform_cap" };
  e.reserved += tokens;
  tenantInFlight.set(tenantId, inFlightTokens(tenantId) + tokens);
  const release = () => {
    e.reserved = Math.max(0, e.reserved - tokens);
    const left = inFlightTokens(tenantId) - tokens;
    if (left > 0) tenantInFlight.set(tenantId, left); else tenantInFlight.delete(tenantId);
  };
  try {
    const units = Math.max(1, Math.ceil(tokens / SPEND_UNIT_TOKENS));
    const capUnits = Math.floor(cap / SPEND_UNIT_TOKENS);
    const key = `engine-ai-day:${day}`; // no personal data in it: a plain key is fine
    const at = now.getTime();
    const hits = await Promise.all(Array.from({ length: units }, () => getData().rateLimits.hit(key, capUnits, 2 * DAY_MS, at)));
    if (hits.some((h) => !h.ok)) { release(); return { ok: false, reason: "platform_cap" }; }
  } catch (err) {
    release();
    console.error("[engine] platform spend check failed:", err instanceof Error ? err.name : "error");
    return { ok: false, reason: "error" };
  }
  return { ok: true, reservation: { tenantId, day, tokens, released: false } };
}

/** Settle a reservation with the tokens actually used (input incl. cache + output). Idempotent. */
export function releaseReservation(r: Reservation, usedTokens: number): void {
  if (r.released) return;
  r.released = true;
  const e = dayEntry(r.day);
  e.reserved = Math.max(0, e.reserved - r.tokens);
  e.used += Math.max(0, usedTokens);
  const left = (tenantInFlight.get(r.tenantId) ?? 0) - r.tokens;
  if (left > 0) tenantInFlight.set(r.tenantId, left); else tenantInFlight.delete(r.tenantId);
}

/** Tokens this process has reserved for the tenant's calls still in flight. */
export const inFlightTokens = (tenantId: string) => tenantInFlight.get(tenantId) ?? 0;

/** Tokens used + reserved today in this process (for tests / ops logs). */
export function platformSpendToday(now: Date): { used: number; reserved: number } {
  const e = days.get(utcDay(now));
  return { used: e?.used ?? 0, reserved: e?.reserved ?? 0 };
}

/** Test helper: forget the in-process counters (the shared counter lives in the data layer). */
export function resetSpendForTests(): void { days.clear(); tenantInFlight.clear(); }
