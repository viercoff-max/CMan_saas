// Sessions for both backends (see lib/auth/backend.ts):
//   sqlite (default): local email + password, signed "session" cookie, one tenant per user (users.tenant_id/role).
//   supabase:         Supabase Auth cookie session (@supabase/ssr) + public.tenant_members; the active tenant cookie is
//                     re-checked against the memberships on every request.
// Callers: requireSession() for any signed-in member, requireRole("admin") for owner/admin-only mutations.
import { cookies } from "next/headers";
import { scrypt as scryptCb, scryptSync, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { sign, safeEqual } from "./crypto";
import { getData } from "./data";
import {
  hashKey, recordLoginFailure, countLoginFailures, clearLoginFailures,
  LOGIN_MAX_FAILS_PER_EMAIL, LOGIN_MAX_FAILS_PER_IP,
} from "./security/rate-limit";
import { authBackend } from "./auth/backend";
import { ACTIVE_TENANT_COOKIE, baseCookieOptions, cookieSecure } from "./auth/cookies";
import { forbiddenResponse, hasRole, isRole, unauthorizedResponse, type Role } from "./auth/roles";
import type { AuthState, Session } from "./auth/session";

export type { Session, AuthState, TenantMembership } from "./auth/session";
export type { Role } from "./auth/roles";
export { cookieSecure, hasRole };

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

export type LoginResult = { ok: boolean };

/**
 * SQLITE MODE. Checks credentials and sets the session cookie. Always returns the same shape and never says whether
 * the email or the password was wrong, or whether the account is temporarily locked (callers show one generic message).
 * Limits: 5 failures per email and 10 per IP in 15 minutes, then every attempt fails until the window passes.
 * (Supabase mode signs in through lib/auth/supabase-account.ts.)
 */
export async function login(email: string, password: string, ip = "unknown"): Promise<LoginResult> {
  const normEmail = email.trim().toLowerCase().slice(0, 320);
  const emailKey = hashKey("login-email", normEmail);
  const ipKey = hashKey("login-ip", ip);
  const locked = (await countLoginFailures(emailKey)) >= LOGIN_MAX_FAILS_PER_EMAIL || (await countLoginFailures(ipKey)) >= LOGIN_MAX_FAILS_PER_IP;

  const data = getData();
  const row = await data.users.findLoginByEmail(normEmail);
  const valid = await verifyPassword(String(password).slice(0, 1024), row && !locked ? row.passwordHash : DUMMY_HASH);

  if (!row || !valid || locked) {
    await recordLoginFailure([emailKey, ipKey]);
    // No password, no raw email: hashed keys only.
    await data.audit.log(row?.tenantId ?? "system", row?.id ?? "anonymous", locked ? "auth.login_locked" : "auth.login_failed",
      `${row ? "known_user" : "unknown_user"} ${ipKey}`);
    return { ok: false };
  }
  await clearLoginFailures(emailKey);
  await data.audit.log(row.tenantId, row.id, "auth.login_ok", ipKey);

  const exp = Date.now() + TTL_MS;
  const payload = `${row.id}.${row.tenantId}.${exp}`;
  (await cookies()).set(COOKIE, `${payload}.${sign(payload)}`, {
    httpOnly: true, sameSite: "lax", secure: cookieSecure(), path: "/", maxAge: TTL_MS / 1000,
  });
  return { ok: true };
}

export async function logout() {
  const jar = await cookies();
  if (authBackend() === "supabase") {
    const { createSupabaseServerClient } = await import("./auth/supabase-server");
    try { await (await createSupabaseServerClient()).auth.signOut({ scope: "local" }); } catch { /* cookies cleared below anyway */ }
    jar.delete(ACTIVE_TENANT_COOKIE);
    return;
  }
  jar.delete(COOKIE);
}

async function sqliteAuthState(): Promise<AuthState> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return { status: "anonymous" };
  const parts = raw.split(".");
  if (parts.length !== 4) return { status: "anonymous" };
  const [userId, tenantId, exp, sig] = parts;
  if (!safeEqual(sign(`${userId}.${tenantId}.${exp}`), sig) || Number(exp) < Date.now()) return { status: "anonymous" };
  const data = getData();
  const u = await data.users.get(userId);
  if (!u) return { status: "anonymous" };
  // L1: a suspended / deleted tenant gives no app access (one tenant per user in SQLite mode).
  if (!(await data.tenants.isActive(u.tenantId))) {
    return { status: "no_tenant", user: { id: u.id, email: u.email, name: u.name }, suspended: true };
  }
  // Role from the users table (least privilege if the row is somehow missing from the member list).
  const found = (await data.members.list(u.tenantId)).find((m) => m.userId === u.id)?.role;
  const role: Role = isRole(found) ? found : "agent";
  const name = (await data.tenants.get(u.tenantId))?.name ?? u.tenantId;
  return {
    status: "ok",
    session: { userId: u.id, tenantId: u.tenantId, role, name: u.name, email: u.email, tenants: [{ id: u.tenantId, name, role }] },
  };
}

async function supabaseAuthState(): Promise<AuthState> {
  const [{ createSupabaseServerClient }, { resolveSupabaseAuth }] = await Promise.all([
    import("./auth/supabase-server"), import("./auth/supabase-session"),
  ]);
  const active = (await cookies()).get(ACTIVE_TENANT_COOKIE)?.value;
  return resolveSupabaseAuth(await createSupabaseServerClient(), active);
}

/** anonymous | signed in without a tenant (Supabase: go to /onboarding) | full session. */
export async function getAuthState(): Promise<AuthState> {
  return authBackend() === "supabase" ? supabaseAuthState() : sqliteAuthState();
}

export async function getSession(): Promise<Session | null> {
  const st = await getAuthState();
  return st.status === "ok" ? st.session : null;
}

/** Use at the top of every server action / route handler that needs a tenant. Throws a 401 Response. */
export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (!s) throw unauthorizedResponse();
  return s;
}

/** Throws a 403 Response unless the session's role in the ACTIVE tenant is at least `min`. */
export function assertRole(s: Session, min: Role): Session {
  if (!hasRole(s.role, min)) throw forbiddenResponse();
  return s;
}

/** requireSession() + role check. requireRole("admin") accepts owner and admin. 401 / 403 thrown as Responses. */
export async function requireRole(min: Role): Promise<Session> {
  return assertRole(await requireSession(), min);
}

/**
 * Switch the active tenant (Supabase mode). Only accepted when the user is a member of `tenantId`; the cookie is
 * still re-validated on every request. Returns false for anything else (no cookie written).
 */
export async function setActiveTenant(tenantId: unknown): Promise<boolean> {
  if (typeof tenantId !== "string" || tenantId.length > 64) return false;
  const s = await getSession();
  if (!s || !s.tenants.some((t) => t.id === tenantId)) return false;
  (await cookies()).set(ACTIVE_TENANT_COOKIE, tenantId, { ...baseCookieOptions(), maxAge: 60 * 60 * 24 * 365 });
  return true;
}
