// Supabase Auth account flows (sign up, sign in, reset). Every result is generic on purpose: the UI never learns
// whether an email is registered. Never log emails, passwords or tokens.
// M2: pass `guard: { ip }` (lib/security/client-ip.ts) from the server actions so each flow is throttled per client
// IP and per e-mail BEFORE Supabase Auth is called (lib/auth/auth-limits.ts). A throttled call gets the same generic
// result as a normal one.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { authAttemptAllowed, clearSignInFailures, recordSignInFailure } from "./auth-limits";

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 72; // Supabase Auth (bcrypt) ignores bytes past 72

const Email = z.string().trim().toLowerCase().max(320).pipe(z.email());
const Password = z.string().min(PASSWORD_MIN).max(PASSWORD_MAX);
const Name = z.string().trim().max(120);

/** Client IP of the request (trusted proxy headers only). Omit only in tests / scripts without a request. */
export interface AuthGuard { ip: string }

export type SignUpResult = { ok: true } | { ok: false; error: "invalid" | "weak_password" | "failed" };

/**
 * Creates the account and sends the confirmation email (link -> /auth/confirm). "Already registered" is reported as
 * success too (Supabase also hides it when email confirmation is on), so the screen always says "revisa tu correo".
 * Throttled (guard): also "ok", and Supabase is not called (no e-mail is sent).
 */
export async function signUp(client: SupabaseClient, input: { email: unknown; password: unknown; name?: unknown }, confirmUrl: string, guard?: AuthGuard): Promise<SignUpResult> {
  const email = Email.safeParse(input.email);
  if (!email.success) return { ok: false, error: "invalid" };
  if (!Password.safeParse(input.password).success) return { ok: false, error: "weak_password" };
  if (guard && !(await authAttemptAllowed("signup", guard.ip, email.data))) return { ok: true };
  const name = Name.safeParse(input.name ?? "");
  const { error } = await client.auth.signUp({
    email: email.data, password: String(input.password),
    options: { emailRedirectTo: confirmUrl, data: name.success && name.data ? { name: name.data } : undefined },
  });
  if (!error) return { ok: true };
  const code = (error as { code?: string }).code ?? "";
  if (code === "user_already_exists" || code === "email_exists") return { ok: true };
  if (code === "weak_password") return { ok: false, error: "weak_password" };
  return { ok: false, error: "failed" };
}

/**
 * Wrong email, wrong password, unconfirmed email and a throttled attempt all look the same to the caller.
 * `userId` only on success (audit). With `guard`: 10 attempts per e-mail / 30 per IP per 15 min, and after 5 failed
 * sign-ins of an e-mail (20 of an IP) every attempt fails for 15 minutes without reaching Supabase.
 */
export async function signIn(client: SupabaseClient, input: { email: unknown; password: unknown }, guard?: AuthGuard): Promise<{ ok: boolean; userId?: string }> {
  const email = Email.safeParse(input.email);
  const pw = typeof input.password === "string" ? input.password.slice(0, 1024) : "";
  if (!email.success || !pw) return { ok: false };
  if (guard && !(await authAttemptAllowed("signin", guard.ip, email.data))) return { ok: false };
  const { data, error } = await client.auth.signInWithPassword({ email: email.data, password: pw });
  const ok = !error && !!data?.user;
  if (guard) await (ok ? clearSignInFailures(email.data) : recordSignInFailure(guard.ip, email.data));
  return ok ? { ok: true, userId: data.user!.id } : { ok: false };
}

/** Always "ok": the screen says "si el correo existe, te enviamos un enlace". Throttled (guard): no e-mail sent. */
export async function requestPasswordReset(client: SupabaseClient, email: unknown, resetUrl: string, guard?: AuthGuard): Promise<{ ok: true }> {
  const e = Email.safeParse(email);
  if (!e.success) return { ok: true };
  if (guard && !(await authAttemptAllowed("reset", guard.ip, e.data))) return { ok: true };
  await client.auth.resetPasswordForEmail(e.data, { redirectTo: resetUrl }).catch(() => undefined);
  return { ok: true };
}

// ---------- L4: password change only from a fresh recovery session (or with the current password) ----------
/** A recovery / e-mail OTP sign-in newer than this may set a new password without the current one. */
export const RECOVERY_MAX_AGE_S = 15 * 60;
/** Supabase AMR methods created by an e-mailed link (verifyOtp type=recovery reports "recovery" or "otp"). */
const RECOVERY_AMR = new Set(["recovery", "otp", "magiclink"]);

type AmrEntry = { method?: unknown; timestamp?: unknown };
/**
 * True when the session's JWT `amr` claim (Supabase: [{ method, timestamp }]) holds an e-mail-link sign-in from the
 * last RECOVERY_MAX_AGE_S seconds. A password or OAuth session, an old link session, or the RFC-8176 string form
 * (no timestamps) is NOT a recovery session.
 */
export function isFreshRecoverySession(claims: { amr?: unknown } | null | undefined, nowS = Math.floor(Date.now() / 1000)): boolean {
  const amr = Array.isArray(claims?.amr) ? (claims.amr as unknown[]) : [];
  return amr.some((e) => {
    if (!e || typeof e !== "object") return false;
    const { method, timestamp } = e as AmrEntry;
    const ts = Number(timestamp);
    return typeof method === "string" && RECOVERY_AMR.has(method) && Number.isFinite(ts) && ts <= nowS + 60 && nowS - ts <= RECOVERY_MAX_AGE_S;
  });
}

export type UpdatePasswordResult = { ok: true } | { ok: false; error: "weak_password" | "expired" | "reauth_required" | "failed" };
/**
 * Sets a new password. Allowed only for a FRESH recovery session (the /auth/confirm type=recovery link, see
 * isFreshRecoverySession) or, for any other session, when `currentPassword` re-authenticates the same user.
 * Anything else is refused ("reauth_required", the server-action equivalent of a 403) before Supabase is called, so
 * a stolen or borrowed ordinary session cannot change the password and lock the owner out.
 */
export async function updatePassword(client: SupabaseClient, password: unknown, opts: { currentPassword?: unknown } = {}): Promise<UpdatePasswordResult> {
  if (!Password.safeParse(password).success) return { ok: false, error: "weak_password" };
  const { data: u } = await client.auth.getClaims();
  const claims = (u?.claims ?? null) as { sub?: string; email?: string; amr?: unknown } | null;
  if (!claims?.sub) return { ok: false, error: "expired" };
  if (!isFreshRecoverySession(claims)) {
    const current = typeof opts.currentPassword === "string" ? opts.currentPassword.slice(0, 1024) : "";
    const email = Email.safeParse(claims.email);
    if (!current || !email.success) return { ok: false, error: "reauth_required" };
    const re = await client.auth.signInWithPassword({ email: email.data, password: current });
    if (re.error || re.data?.user?.id !== claims.sub) return { ok: false, error: "reauth_required" };
  }
  const { error } = await client.auth.updateUser({ password: String(password) });
  if (!error) return { ok: true };
  const code = (error as { code?: string }).code ?? "";
  return { ok: false, error: code === "weak_password" || code === "same_password" ? "weak_password" : "failed" };
}
