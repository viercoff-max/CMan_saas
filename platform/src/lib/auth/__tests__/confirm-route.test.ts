// /auth/confirm: email links. Only relative `next` targets; failures go to a generic notice (offline mocks).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const G = globalThis as { __jar2?: Map<string, string>; __verify?: ReturnType<typeof vi.fn>; __exchange?: ReturnType<typeof vi.fn> };
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (G.__jar2?.has(n) ? { name: n, value: G.__jar2.get(n)! } : undefined),
    delete: (n: string) => { G.__jar2?.delete(n); },
    set: () => {}, getAll: () => [],
  }),
}));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); } }));
vi.mock("@/lib/auth/supabase-server", () => ({
  createSupabaseServerClient: async () => ({ auth: { verifyOtp: G.__verify, exchangeCodeForSession: G.__exchange } }),
}));

import { GET } from "@/app/auth/confirm/route";

const go = async (qs: string) => String(await GET(new Request(`https://app.example/auth/confirm?${qs}`)).catch((e: Error) => e));

beforeEach(() => {
  process.env.DATA_BACKEND = "supabase";
  G.__jar2 = new Map();
  G.__verify = vi.fn(async () => ({ error: null }));
  G.__exchange = vi.fn(async () => ({ error: null }));
});
afterEach(() => { delete process.env.DATA_BACKEND; });

describe("GET /auth/confirm", () => {
  it("token_hash link: verifies and continues to a relative next", async () => {
    expect(await go("token_hash=abc&type=signup&next=%2Fauth%2Finvite%3Ftoken%3Dt")).toContain("REDIRECT:/auth/invite?token=t");
    expect(G.__verify).toHaveBeenCalledWith({ type: "signup", token_hash: "abc" });
  });
  it("open redirect attempts fall back to the app", async () => {
    expect(await go("token_hash=abc&type=email&next=https%3A%2F%2Fevil.example")).toContain("REDIRECT:/dashboard");
    expect(await go("token_hash=abc&type=email&next=%2F%2Fevil.example")).toContain("REDIRECT:/dashboard");
  });
  it("recovery defaults to the new-password screen; the next cookie is used once when the query has none", async () => {
    expect(await go("token_hash=abc&type=recovery")).toContain("REDIRECT:/login/reset");
    G.__jar2!.set("auth_next", "/auth/invite?token=zz");
    expect(await go("code=c1")).toContain("REDIRECT:/auth/invite?token=zz");
    expect(G.__exchange).toHaveBeenCalledWith("c1");
    expect(G.__jar2!.has("auth_next")).toBe(false);
  });
  it("invalid / expired / unknown type -> generic notice", async () => {
    G.__verify = vi.fn(async () => ({ error: { message: "expired" } }));
    expect(await go("token_hash=abc&type=signup")).toContain("REDIRECT:/login?notice=link_invalid");
    expect(await go("token_hash=abc&type=phone_change")).toContain("REDIRECT:/login?notice=link_invalid");
    expect(await go("")).toContain("REDIRECT:/login?notice=link_invalid");
  });
  it("sqlite mode: route is inert", async () => {
    process.env.DATA_BACKEND = "sqlite";
    expect(await go("token_hash=abc&type=signup")).toContain("REDIRECT:/login");
  });
});
