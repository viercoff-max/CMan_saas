import { cookies } from "next/headers";
import { scrypt as scryptCb, scryptSync, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { sign, safeEqual } from "./crypto";
import { getDb } from "./db";
import { audit } from "./store";
import {
  hashKey, recordLoginFailure, countLoginFailures, clearLoginFailures,
  LOGIN_MAX_FAILS_PER_EMAIL, LOGIN_MAX_FAILS_PER_IP,
} from "./security/rate-limit";

export type Session = { userId: string; tenantId: string; name: string; email: string };
const COOKIE = "session";
const TTL_MS = 1000 * 60 * 60 * 12;
const scrypt = promisify(scryptCb) as (pw: string, salt: string, len: number) => Promise<Buffer>;

/** Sync version: only for one-off seeding/tests (blocks the event loop). */
export function hashPassword(pw: string): string {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${scryptSync(pw, salt, 64).toString("hex")}`;
}
export async function hashPasswordAsync(pw: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  return `${salt}:${(await scrypt(pw, salt, 64)).toString("hex")}`;
}
/** Async scrypt so a login burst does not block webhooks/inbox. */
export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(":");
  if (!salt || !hash) return false;
  return safeEqual((await scrypt(pw, salt, 64)).toString("hex"), hash);
}
// Used when the user does not exist or is locked, so every attempt costs the same scrypt (no timing enumeration).
const DUMMY_HASH = `${"0".repeat(32)}:${"0".repeat(128)}`;

/** Secure cookies whenever the app is served over HTTPS (tunnel), not only under NODE_ENV=production. */
export function cookieSecure(): boolean {
  return process.env.NODE_ENV === "production" || (process.env.PUBLIC_URL ?? "").toLowerCase().startsWith("https://");
}

export type LoginResult = { ok: boolean };

/**
 * Checks credentials and sets the session cookie. Always returns the same shape and never says whether the email
 * or the password was wrong, or whether the account is temporarily locked (callers show one generic message).
 * Limits: 5 failures per email and 10 per IP in 15 minutes, then every attempt fails until the window passes.
 */
export async function login(email: string, password: string, ip = "unknown"): Promise<LoginResult> {
  const normEmail = email.trim().toLowerCase().slice(0, 320);
  const emailKey = hashKey("login-email", normEmail);
  const ipKey = hashKey("login-ip", ip);
  const locked = countLoginFailures(emailKey) >= LOGIN_MAX_FAILS_PER_EMAIL || countLoginFailures(ipKey) >= LOGIN_MAX_FAILS_PER_IP;

  const row = getDb().prepare("SELECT id, tenant_id, password_hash FROM users WHERE email = ?").get(normEmail) as
    | { id: string; tenant_id: string; password_hash: string } | undefined;
  const valid = await verifyPassword(String(password).slice(0, 1024), row && !locked ? row.password_hash : DUMMY_HASH);

  if (!row || !valid || locked) {
    recordLoginFailure([emailKey, ipKey]);
    // No password, no raw email: hashed keys only.
    audit(row?.tenant_id ?? "system", row?.id ?? "anonymous", locked ? "auth.login_locked" : "auth.login_failed",
      `${row ? "known_user" : "unknown_user"} ${ipKey}`);
    return { ok: false };
  }
  clearLoginFailures(emailKey);
  audit(row.tenant_id, row.id, "auth.login_ok", ipKey);

  const exp = Date.now() + TTL_MS;
  const payload = `${row.id}.${row.tenant_id}.${exp}`;
  (await cookies()).set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true, sameSite: "lax", secure: cookieSecure(), path: "/", maxAge: TTL_MS / 1000,
  });
  return { ok: true };
}
export async function logout() { (await cookies()).delete(COOKIE); }
export async function getSession(): Promise<Session | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  const parts = raw.split(".");
  if (parts.length !== 4) return null;
  const [userId, tenantId, exp, sig] = parts;
  if (!safeEqual(sign(`${userId}.${tenantId}.${exp}`), sig) || Number(exp) < Date.now()) return null;
  const u = getDb().prepare("SELECT id, tenant_id, name, email FROM users WHERE id = ?").get(userId) as
    | { id: string; tenant_id: string; name: string; email: string } | undefined;
  return u ? { userId: u.id, tenantId: u.tenant_id, name: u.name, email: u.email } : null;
}
/** Use at the top of every server action / route handler that needs a tenant. Throws a 401 Response. */
export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
  return s;
}
