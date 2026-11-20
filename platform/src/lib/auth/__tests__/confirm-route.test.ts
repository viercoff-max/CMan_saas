// /auth/confirm: email links. Only relative `next` targets; failures go to a generic notice (offline mocks).
// L3 (REVIEW-security-2): a token_hash link never signs in on GET; only the same-origin POST of the confirm page does.
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

import { GET, POST } from "@/app/auth/confirm/route";

const ORIGIN = "https://app.example";
const go = async (qs: string) => String(await GET(new Request(`${ORIGIN}/auth/confirm?${qs}`)).catch((e: Error) => e));
const page = async (qs: string) => {
  const r = await GET(new Request(`${ORIGIN}/auth/confirm?${qs}`));
  return { r, html: await r.text() };
};
const post = (fields: Record<string, string>, headers: Record<string, string> = { origin: ORIGIN, "sec-fetch-site": "same-origin" }) => {
  const body = new URLSearchParams(fields).toString();
  return POST(new Request(`${ORIGIN}/auth/confirm`, {
    method: "POST", body,
    headers: { "content-type": "application/x-www-form-urlencoded", "content-length": String(body.length), host: "app.example", ...headers },
  }));
};

beforeEach(() => {
  process.env.DATA_BACKEND = "supabase";
  G.__jar2 = new Map();
  G.__verify = vi.fn(async () => ({ error: null }));
  G.__exchange = vi.fn(async () => ({ error: null }));
});
afterEach(() => { delete process.env.DATA_BACKEND; });

describe("GET /auth/confirm (token_hash): interstitial only", () => {
  it("renders a confirm page and does NOT verify the token (no silent sign-in from a link)", async () => {
    const { r, html } = await page("token_hash=abc&type=signup&next=%2Fauth%2Finvite%3Ftoken%3Dt");
    expect(r.status).toBe(200);
    expect(G.__verify).not.toHaveBeenCalled();
    expect(html).toContain('<form method="post" action="/auth/confirm">');
    expect(html).toContain('name="token_hash" value="abc"');
    expect(html).toContain('name="next" value="/auth/invite?token=t"');
    expect(r.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
  it("escapes every reflected value; open redirects fall back to the app", async () => {
    const { html } = await page(`token_hash=${encodeURIComponent('"><script>alert(1)</script>')}&type=email&next=https%3A%2F%2Fevil.example`);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&quot;&gt;&lt;script&gt;");
    expect(html).toContain('name="next" value="/dashboard"');
    expect((await page("token_hash=abc&type=email&next=%2F%2Fevil.example")).html).toContain('name="next" value="/dashboard"');
  });
  it("recovery defaults to the new-password screen", async () => {
    expect((await page("token_hash=abc&type=recovery")).html).toContain('name="next" value="/login/reset"');
  });
  it("invalid / unknown type -> generic notice", async () => {
    expect(await go("token_hash=abc&type=phone_change")).toContain("REDIRECT:/login?notice=link_invalid");
    expect(await go(`token_hash=${"x".repeat(600)}&type=signup`)).toContain("REDIRECT:/login?notice=link_invalid");
    expect(await go("")).toContain("REDIRECT:/login?notice=link_invalid");
    expect(G.__verify).not.toHaveBeenCalled();
  });
});

describe("POST /auth/confirm (the confirm button)", () => {
  it("same-origin POST verifies and 303s to a relative next", async () => {
    const r = await post({ token_hash: "abc", type: "signup", next: "/auth/invite?token=t" });
    expect(G.__verify).toHaveBeenCalledWith({ type: "signup", token_hash: "abc" });
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/auth/invite?token=t");
    const evil = await post({ token_hash: "abc", type: "email", next: "https://evil.example" });
    expect(evil.headers.get("location")).toBe("/dashboard");
  });
  it("cross-site POST (login CSRF) is refused before verifyOtp", async () => {
    const r = await post({ token_hash: "abc", type: "magiclink" }, { origin: "https://evil.example", "sec-fetch-site": "cross-site" });
    expect(r.status).toBe(403);
    const noOrigin = await post({ token_hash: "abc", type: "magiclink" }, {});
    expect(noOrigin.status).toBe(403);
    expect(G.__verify).not.toHaveBeenCalled();
  });
  it("expired token or bad input -> generic notice", async () => {
    G.__verify = vi.fn(async () => ({ error: { message: "expired" } }));
    expect((await post({ token_hash: "abc", type: "signup" })).headers.get("location")).toBe("/login?notice=link_invalid");
    expect((await post({ token_hash: "abc", type: "phone_change" })).headers.get("location")).toBe("/login?notice=link_invalid");
    expect((await post({ type: "signup" })).headers.get("location")).toBe("/login?notice=link_invalid");
  });
});

describe("PKCE code links and sqlite mode", () => {
  it("code: exchanged on GET (bound to this browser); the next cookie is used once when the query has none", async () => {
    G.__jar2!.set("auth_next", "/auth/invite?token=zz");
    expect(await go("code=c1")).toContain("REDIRECT:/auth/invite?token=zz");
    expect(G.__exchange).toHaveBeenCalledWith("c1");
    expect(G.__jar2!.has("auth_next")).toBe(false);
    G.__exchange = vi.fn(async () => ({ error: { message: "bad" } }));
    expect(await go("code=c2")).toContain("REDIRECT:/login?notice=link_invalid");
  });
  it("sqlite mode: route is inert", async () => {
    process.env.DATA_BACKEND = "sqlite";
    expect(await go("token_hash=abc&type=signup")).toContain("REDIRECT:/login");
    expect((await post({ token_hash: "abc", type: "signup" })).headers.get("location")).toBe("/login");
    expect(G.__verify).not.toHaveBeenCalled();
  });
});
