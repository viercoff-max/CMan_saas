// Supabase Auth account flows (sign up, sign in, reset). Every result is generic on purpose: the UI never learns
// whether an email is registered. Never log emails, passwords or tokens.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 72; // Supabase Auth (bcrypt) ignores bytes past 72

const Email = z.string().trim().toLowerCase().max(320).pipe(z.email());
const Password = z.string().min(PASSWORD_MIN).max(PASSWORD_MAX);
const Name = z.string().trim().max(120);

export type SignUpResult = { ok: true } | { ok: false; error: "invalid" | "weak_password" | "failed" };

/**
 * Creates the account and sends the confirmation email (link -> /auth/confirm). "Already registered" is reported as
 * success too (Supabase also hides it when email confirmation is on), so the screen always says "revisa tu correo".
 */
export async function signUp(client: SupabaseClient, input: { email: unknown; password: unknown; name?: unknown }, confirmUrl: string): Promise<SignUpResult> {
  const email = Email.safeParse(input.email);
  if (!email.success) return { ok: false, error: "invalid" };
  if (!Password.safeParse(input.password).success) return { ok: false, error: "weak_password" };
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

/** Wrong email, wrong password and unconfirmed email all look the same to the caller. `userId` only on success (audit). */
export async function signIn(client: SupabaseClient, input: { email: unknown; password: unknown }): Promise<{ ok: boolean; userId?: string }> {
  const email = Email.safeParse(input.email);
  const pw = typeof input.password === "string" ? input.password.slice(0, 1024) : "";
  if (!email.success || !pw) return { ok: false };
  const { data, error } = await client.auth.signInWithPassword({ email: email.data, password: pw });
  return !error && data?.user ? { ok: true, userId: data.user.id } : { ok: false };
}

/** Always "ok": the screen says "si el correo existe, te enviamos un enlace". */
export async function requestPasswordReset(client: SupabaseClient, email: unknown, resetUrl: string): Promise<{ ok: true }> {
  const e = Email.safeParse(email);
  if (e.success) await client.auth.resetPasswordForEmail(e.data, { redirectTo: resetUrl }).catch(() => undefined);
  return { ok: true };
}

export type UpdatePasswordResult = { ok: true } | { ok: false; error: "weak_password" | "expired" | "failed" };
/** Needs the recovery session created by /auth/confirm (type=recovery). */
export async function updatePassword(client: SupabaseClient, password: unknown): Promise<UpdatePasswordResult> {
  if (!Password.safeParse(password).success) return { ok: false, error: "weak_password" };
  const { data: u } = await client.auth.getClaims();
  if (!u?.claims?.sub) return { ok: false, error: "expired" };
  const { error } = await client.auth.updateUser({ password: String(password) });
  if (!error) return { ok: true };
  const code = (error as { code?: string }).code ?? "";
  return { ok: false, error: code === "weak_password" || code === "same_password" ? "weak_password" : "failed" };
}
