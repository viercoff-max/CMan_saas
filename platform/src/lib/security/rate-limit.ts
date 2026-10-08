// Small SQLite-backed limiters (single on-prem Node process; replace with an edge/Redis limiter in the cloud).
// Keys are HMAC-hashed with APP_SECRET so the tables never hold raw emails or IPs.
// Tables are created lazily, so no schema change in db.ts/store.ts is needed.
import { getDb } from "../db";
import { sign } from "../crypto";

const g = globalThis as { __rlReady?: unknown };
function db() {
  const d = getDb();
  if (g.__rlReady !== d) { // once per DB handle (tests may swap the DB)
    d.exec(`
      CREATE TABLE IF NOT EXISTS rate_limits (
        key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS login_attempts (
        key TEXT NOT NULL, at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_login_attempts ON login_attempts(key, at);
    `);
    g.__rlReady = d;
  }
  return d;
}

/** Stable, non-reversible key for a purpose + value (e.g. ("login-email", "a@b.c")). */
export function hashKey(purpose: string, value: string): string {
  return `${purpose}:${sign(`${purpose}|${value.trim().toLowerCase()}`).slice(0, 32)}`;
}

/** Fixed-window counter. Returns ok=false once more than `limit` hits happened in the current window. */
export function hit(key: string, limit: number, windowMs: number, now = Date.now()): { ok: boolean; retryAfterS: number } {
  const d = db();
  const row = d.prepare("SELECT window_start, count FROM rate_limits WHERE key = ?").get(key) as
    | { window_start: number; count: number } | undefined;
  if (!row || now - row.window_start >= windowMs) {
    d.prepare("INSERT INTO rate_limits (key, window_start, count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start, count=1")
      .run(key, now);
    return { ok: true, retryAfterS: 0 };
  }
  d.prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ?").run(key);
  const ok = row.count + 1 <= limit;
  return { ok, retryAfterS: ok ? 0 : Math.ceil((row.window_start + windowMs - now) / 1000) };
}

/** Per-tenant route limiter that returns a 429 Response (or null when allowed). */
export function limitOr429(key: string, limit: number, windowMs: number): Response | null {
  const r = hit(key, limit, windowMs);
  if (r.ok) return null;
  return new Response(JSON.stringify({ error: "rate_limited" }), {
    status: 429, headers: { "content-type": "application/json", "retry-after": String(r.retryAfterS) },
  });
}

// ---------- login failures (sliding window) ----------
export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_FAILS_PER_EMAIL = 5;
export const LOGIN_MAX_FAILS_PER_IP = 10;

export function recordLoginFailure(keys: string[], now = Date.now()): void {
  const ins = db().prepare("INSERT INTO login_attempts (key, at) VALUES (?, ?)");
  for (const k of keys) ins.run(k, now);
}
export function countLoginFailures(key: string, now = Date.now()): number {
  return (db().prepare("SELECT COUNT(*) c FROM login_attempts WHERE key = ? AND at > ?").get(key, now - LOGIN_WINDOW_MS) as { c: number }).c;
}
export function clearLoginFailures(key: string): void {
  db().prepare("DELETE FROM login_attempts WHERE key = ?").run(key);
}
/** Retention: drop login rows and stale rate-limit windows older than `olderThanMs` (default 24 h). */
export function purgeSecurityRows(now = Date.now(), olderThanMs = 24 * 60 * 60 * 1000): number {
  const d = db();
  const a = Number(d.prepare("DELETE FROM login_attempts WHERE at < ?").run(now - olderThanMs).changes);
  const b = Number(d.prepare("DELETE FROM rate_limits WHERE window_start < ?").run(now - olderThanMs).changes);
  return a + b;
}
