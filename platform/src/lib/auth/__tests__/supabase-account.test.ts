// Account flows never reveal whether an email exists (mocked Supabase Auth, offline).
import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { requestPasswordReset, signIn, signUp, updatePassword } from "../supabase-account";

const auth = (over: Record<string, unknown>) => ({ auth: { getClaims: async () => ({ data: { claims: { sub: "u1" } }, error: null }), ...over } }) as unknown as SupabaseClient;

describe("signUp", () => {
  it("sends the confirmation link to /auth/confirm and stores the name only as metadata", async () => {
    const fn = vi.fn(async () => ({ data: {}, error: null }));
    expect(await signUp(auth({ signUp: fn }), { email: " Ana@Example.test ", password: "0123456789", name: "Ana" }, "https://app.example/auth/confirm?next=%2Fdashboard")).toEqual({ ok: true });
    expect(fn).toHaveBeenCalledWith({ email: "ana@example.test", password: "0123456789", options: { emailRedirectTo: "https://app.example/auth/confirm?next=%2Fdashboard", data: { name: "Ana" } } });
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
    expect(await updatePassword(auth({ updateUser: async () => ({ data: {}, error: null }) }), "0123456789")).toEqual({ ok: true });
    expect(await updatePassword(auth({ updateUser: vi.fn() }), "short")).toEqual({ ok: false, error: "weak_password" });
  });
});
