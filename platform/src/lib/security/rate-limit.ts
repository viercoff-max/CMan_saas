// Small limiters (single on-prem Node process today; an edge/Redis limiter fits behind the same interface later).
// Keys are HMAC-hashed with APP_SECRET so storage never holds raw emails or IPs. Storage: getData().rateLimits.
import { getData } from "../data";
import { sign } from "../crypto";

/** Stable, non-reversible key for a purpose + value (e.g. ("login-email", "a@b.c")). */
export function hashKey(purpose: string, value: string): string {
  return `${purpose}:${sign(`${purpose}|${value.trim().toLowerCase()}`).slice(0, 32)}`;
}

/** Fixed-window counter. Returns ok=false once more than `limit` hits happened in the current window. */
export function hit(key: string, limit: number, windowMs: number, now = Date.now()): Promise<{ ok: boolean; retryAfterS: number }> {
  return getData().rateLimits.hit(key, limit, windowMs, now);
}

/** Per-tenant route limiter that returns a 429 Response (or null when allowed). */
export async function limitOr429(key: string, limit: number, windowMs: number): Promise<Response | null> {
  const r = await hit(key, limit, windowMs);
  if (r.ok) return null;
  return new Response(JSON.stringify({ error: "rate_limited" }), {
    status: 429, headers: { "content-type": "application/json", "retry-after": String(r.retryAfterS) },
  });
}

// ---------- login failures (sliding window) ----------
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_FAILS_PER_EMAIL = 5;
export const LOGIN_MAX_FAILS_PER_IP = 10;

export function recordLoginFailure(keys: string[], now = Date.now()): Promise<void> {
  return getData().rateLimits.recordLoginFailure(keys, now);
}
export function countLoginFailures(key: string, now = Date.now()): Promise<number> {
  return getData().rateLimits.countLoginFailures(key, now - LOGIN_WINDOW_MS);
}
export function clearLoginFailures(key: string): Promise<void> {
  return getData().rateLimits.clearLoginFailures(key);
}
/** Retention: drop login rows and stale rate-limit windows older than `olderThanMs` (default 24 h). */
export function purgeSecurityRows(now = Date.now(), olderThanMs = 24 * 60 * 60 * 1000): Promise<number> {
  return getData().rateLimits.purge(now - olderThanMs);
}
