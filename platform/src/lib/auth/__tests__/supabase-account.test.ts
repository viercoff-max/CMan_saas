// Account flows never reveal whether an email exists (mocked Supabase Auth, offline).
import "../../channels/__tests__/env-secrets"; // temp SQLite + APP_SECRET for the limiter (M2)
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { isFreshRecoverySession, requestPasswordReset, signIn, signUp, updatePassword, RECOVERY_MAX_AGE_S } from "../supabase-account";
import { AUTH_LIMITS, SIGNIN_MAX_FAILS_PER_EMAIL } from "../auth-limits";

const auth = (over: Record<string, unknown>) => ({ auth: { getClaims: async () => ({ data: { claims: { sub: "u1" } }, error: null }), ...over } }) as unknown as SupabaseClient;

describe("signUp", () => {
  it("sends the confirmation link to /auth/confirm and stores the name only as metadata", async () => {
    const fn = vi.fn(async () => ({ data: {}, error: null }));
    expect(await signUp(auth({ signUp: fn }), { email: " Ana@Example.test ", password: "0123456789", name: "Ana" }, "https://app.example/auth/confirm?next=%2Fdashboard")).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledWith({ email: "ana@example.test", password: "0123456789", options: { emailRedirectTo: "https://app.example/auth/confirm?next=%2Fdashboard", data: { name: "Ana" } } });
  });
  it("with 'Confirm email' off Supabase returns a session: reported as signedIn (the page sends the user straight in)", async () => {
    const fn = vi.fn(async () => ({ data: { user: { id: "u1" }, session: { access_token: "t" } }, error: null }));
    expect(await signUp(auth({ signUp: fn }), { email: "ana@example.test", password: "0123456789" }, "https://x")).toEqual({ ok: true, signedIn: true });
  });
  it("an already-registered email looks exactly like success", async () => {
    const c = auth({ signUp: async () => ({ data: {}, error: { code: "user_already_exists", message: "User already registered" } }) });
    expect(await signUp(c, { email: "a@b.test", password: "0123456789" }, "https://x")).toEqual({ ok: true });
  });
  it("weak password and bad email are checked before calling Auth; other errors are generic", async () => {
    const fn = vi.fn();
    expect(await signUp(auth({ signUp: fn }), { email: "a@b.test", password: "short" }, "https://x")).toEqual({ ok: false, error: "weak_password" });
    expect(await signUp(auth({ signUp: fn }), { email: "not-an-email", password: "0123456789" }, "https://x")).toEqual({ ok: false, error: "invalid" });
    expect(fn).not.toHaveBeenCalled();
    const c = auth({ signUp: async () => ({ data: {}, error: { code: "over_email_send_rate_limit", message: "details" } }) });
    expect(await signUp(c, { email: "a@b.test", password: "0123456789" }, "https://x")).toEqual({ ok: false, error: "failed" });
  });
});

describe("signIn / reset", () => {
  it("wrong password, unknown email and unconfirmed email give the same result", async () => {
    for (const code of ["invalid_credentials", "email_not_confirmed", "user_not_found"]) {
      const c = auth({ signInWithPassword: async () => ({ data: { user: null }, error: { code, message: code } }) });
      expect(await signIn(c, { email: "a@b.test", password: "x" })).toEqual({ ok: false });
    }
    const ok = auth({ signInWithPassword: async () => ({ data: { user: { id: "u1" } }, error: null }) });
    expect(await signIn(ok, { email: "a@b.test", password: "x" })).toEqual({ ok: true, userId: "u1" });
  });
  it("password reset always answers ok (and swallows Auth errors)", async () => {
    const fn = vi.fn(async () => { throw new Error("network"); });
    expect(await requestPasswordReset(auth({ resetPasswordForEmail: fn }), "a@b.test", "https://x/auth/confirm?next=%2Flogin%2Freset")).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledWith("a@b.test", { redirectTo: "https://x/auth/confirm?next=%2Flogin%2Freset" });
    expect(await requestPasswordReset(auth({ resetPasswordForEmail: fn }), "junk", "https://x")).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it("updatePassword needs the recovery session", async () => {
    const none = { auth: { getClaims: async () => ({ data: null, error: { message: "x" } }), updateUser: vi.fn() } } as unknown as SupabaseClient;
    expect(await updatePassword(none, "0123456789")).toEqual({ ok: false, error: "expired" });
    expect(await updatePassword(recovery({ updateUser: async () => ({ data: {}, error: null }) }), "0123456789")).toEqual({ ok: true });
    expect(await updatePassword(auth({ updateUser: vi.fn() }), "short")).toEqual({ ok: false, error: "weak_password" });
  });
});

// L4 (REVIEW-security-2): a password change needs a FRESH recovery session or the current password.
const nowS = () => Math.floor(Date.now() / 1000);
const withClaims = (claims: Record<string, unknown>, over: Record<string, unknown> = {}) =>
  ({ auth: { getClaims: async () => ({ data: { claims }, error: null }), ...over } }) as unknown as SupabaseClient;
const recovery = (over: Record<string, unknown>) => withClaims({ sub: "u1", email: "a@b.test", amr: [{ method: "recovery", timestamp: nowS() - 60 }] }, over);

describe("updatePassword (L4)", () => {
  it("an ordinary password session cannot change the password without re-auth (Supabase never called)", async () => {
    const updateUser = vi.fn(async () => ({ data: {}, error: null }));
    const pwSession = withClaims({ sub: "u1", email: "a@b.test", amr: [{ method: "password", timestamp: nowS() - 30 }] }, { updateUser });
    expect(await updatePassword(pwSession, "0123456789")).toEqual({ ok: false, error: "reauth_required" });
    const noAmr = withClaims({ sub: "u1", email: "a@b.test" }, { updateUser });
    expect(await updatePassword(noAmr, "0123456789")).toEqual({ ok: false, error: "reauth_required" });
    const oldLink = withClaims({ sub: "u1", email: "a@b.test", amr: [{ method: "recovery", timestamp: nowS() - RECOVERY_MAX_AGE_S - 5 }] }, { updateUser });
    expect(await updatePassword(oldLink, "0123456789")).toEqual({ ok: false, error: "reauth_required" });
    expect(updateUser).not.toHaveBeenCalled();
  });
  it("a fresh recovery/otp link session may set it; the current password re-authenticates any other session", async () => {
    const updateUser = vi.fn(async () => ({ data: {}, error: null }));
    expect(await updatePassword(withClaims({ sub: "u1", amr: [{ method: "otp", timestamp: nowS() - 10 }] }, { updateUser }), "0123456789")).toEqual({ ok: true });
    const signInWithPassword = vi.fn(async ({ password }: { password: string }) =>
      password === "right-password" ? { data: { user: { id: "u1" } }, error: null } : { data: { user: null }, error: { code: "invalid_credentials" } });
    const pw = withClaims({ sub: "u1", email: "A@B.test", amr: [{ method: "password", timestamp: nowS() }] }, { updateUser, signInWithPassword });
    expect(await updatePassword(pw, "0123456789", { currentPassword: "wrong" })).toEqual({ ok: false, error: "reauth_required" });
    expect(await updatePassword(pw, "0123456789", { currentPassword: "right-password" })).toEqual({ ok: true });
    expect(signInWithPassword).toHaveBeenLastCalledWith({ email: "a@b.test", password: "right-password" });
    // Re-auth must prove the SAME user.
    const other = vi.fn(async () => ({ data: { user: { id: "someone-else" } }, error: null }));
    expect(await updatePassword(withClaims({ sub: "u1", email: "a@b.test" }, { updateUser, signInWithPassword: other }), "0123456789", { currentPassword: "x" }))
      .toEqual({ ok: false, error: "reauth_required" });
  });
  it("isFreshRecoverySession ignores the RFC-8176 string form and future timestamps", () => {
    expect(isFreshRecoverySession({ amr: ["recovery"] })).toBe(false);
    expect(isFreshRecoverySession({ amr: [{ method: "recovery", timestamp: nowS() + 3600 }] })).toBe(false);
    expect(isFreshRecoverySession({ amr: [{ method: "password", timestamp: nowS() }, { method: "recovery", timestamp: nowS() }] })).toBe(true);
    expect(isFreshRecoverySession(null)).toBe(false);
  });
});

// M2 (REVIEW-security-2): per-IP / per-e-mail throttling before Supabase Auth, with generic results.
describe("auth limits (M2)", () => {
  it("sign-in: after 5 failures of an e-mail every attempt fails without calling Supabase; other e-mails unaffected", async () => {
    const email = `victim-${randomUUID()}@example.test`, ip = `198.51.100.${Math.floor(Math.random() * 200)}`;
    const bad = vi.fn(async () => ({ data: { user: null }, error: { code: "invalid_credentials" } }));
    for (let i = 0; i < SIGNIN_MAX_FAILS_PER_EMAIL; i++) expect(await signIn(auth({ signInWithPassword: bad }), { email, password: "x" }, { ip })).toEqual({ ok: false });
    expect(bad).toHaveBeenCalledTimes(SIGNIN_MAX_FAILS_PER_EMAIL);
    const good = vi.fn(async () => ({ data: { user: { id: "u1" } }, error: null }));
    expect(await signIn(auth({ signInWithPassword: good }), { email, password: "right" }, { ip: "203.0.113.9" })).toEqual({ ok: false });
    expect(good).not.toHaveBeenCalled();
    expect(await signIn(auth({ signInWithPassword: good }), { email: `other-${randomUUID()}@example.test`, password: "right" }, { ip: "203.0.113.9" })).toEqual({ ok: true, userId: "u1" });
  });
  it("sign-up and reset: 3 per e-mail per hour; the 4th still answers ok but sends nothing", async () => {
    const email = `new-${randomUUID()}@example.test`;
    const up = vi.fn(async () => ({ data: {}, error: null }));
    for (let i = 0; i < AUTH_LIMITS.signup.perEmail + 2; i++)
      expect(await signUp(auth({ signUp: up }), { email, password: "0123456789" }, "https://x", { ip: `192.0.2.${i}` })).toEqual({ ok: true });
    expect(up).toHaveBeenCalledTimes(AUTH_LIMITS.signup.perEmail);
    const reset = vi.fn(async () => ({ data: {}, error: null }));
    for (let i = 0; i < AUTH_LIMITS.reset.perEmail + 2; i++)
      expect(await requestPasswordReset(auth({ resetPasswordForEmail: reset }), email, "https://x", { ip: `192.0.2.${i}` })).toEqual({ ok: true });
    expect(reset).toHaveBeenCalledTimes(AUTH_LIMITS.reset.perEmail);
  });
  it("per-IP limit: one IP cannot spray many e-mails", async () => {
    const ip = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.7`;
    const reset = vi.fn(async () => ({ data: {}, error: null }));
    for (let i = 0; i < AUTH_LIMITS.reset.perIp + 3; i++) await requestPasswordReset(auth({ resetPasswordForEmail: reset }), `spray-${i}-${randomUUID()}@example.test`, "https://x", { ip });
    expect(reset).toHaveBeenCalledTimes(AUTH_LIMITS.reset.perIp);
  });
});
