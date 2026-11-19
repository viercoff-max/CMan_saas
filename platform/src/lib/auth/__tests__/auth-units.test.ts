// Pure helpers of the auth layer: redirects, slugs, invitation tokens, roles, active-tenant selection.
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { safeNext, withNext } from "../redirect";
import { isValidSlug, slugify } from "../slug";
import { hashInviteToken, looksLikeInviteToken, newInviteToken } from "../invite-token";
import { hasRole, isRole } from "../roles";
import { pickActiveTenant, toSession, type TenantMembership } from "../session";
import { authBackend } from "../backend";
import { cookieSecure } from "../cookies";

describe("safeNext (open-redirect guard)", () => {
  it("keeps relative paths with query and hash", () => {
    expect(safeNext("/inbox")).toBe("/inbox");
    expect(safeNext("/auth/invite?token=abc_DEF-1")).toBe("/auth/invite?token=abc_DEF-1");
    expect(safeNext("/team#x")).toBe("/team#x");
  });
  it.each([
    "https://evil.example/x", "http://evil.example", "//evil.example", "///evil.example", "/\\evil.example", "\\\\evil.example",
    "javascript:alert(1)", "evil.example", "", "   ", "/ok\nSet-Cookie:x", "/\u0000", "/a\r\nLocation: https://evil.example",
  ])("rejects %j", (bad) => {
    expect(safeNext(bad)).toBe("/dashboard");
  });
  it("rejects non-strings and very long values, with a custom fallback", () => {
    expect(safeNext(undefined, "/x")).toBe("/x");
    expect(safeNext(42 as unknown, "/x")).toBe("/x");
    expect(safeNext("/" + "a".repeat(3000), "/x")).toBe("/x");
  });
  it("withNext only appends safe, non-default targets", () => {
    expect(withNext("/login", "/auth/invite?token=t")).toBe("/login?next=%2Fauth%2Finvite%3Ftoken%3Dt");
    expect(withNext("/login?error=1", "/inbox")).toBe("/login?error=1&next=%2Finbox");
    expect(withNext("/login", "https://evil.example")).toBe("/login");
    expect(withNext("/login", "/dashboard")).toBe("/login");
  });
});

describe("slugify", () => {
  it("lowercases, strips accents and symbols, collapses dashes", () => {
    expect(slugify("Café Aurora & Co.")).toBe("cafe-aurora-co");
    expect(slugify("  Panadería   El Niño  ")).toBe("panaderia-el-nino");
    expect(slugify("Chefman")).toBe("chefman");
  });
  it("always returns a slug that passes the DB check", () => {
    for (const n of ["", "!!!", "a", "Ñ", "x".repeat(200), "-a-", "日本の店", "a--b", `${"a".repeat(62)}-b`]) {
      const s = slugify(n);
      expect(isValidSlug(s), `${n} -> ${s}`).toBe(true);
    }
  });
  it("isValidSlug mirrors ^[a-z0-9][a-z0-9-]{1,62}$", () => {
    expect(isValidSlug("ab")).toBe(true);
    expect(isValidSlug("a")).toBe(false);
    expect(isValidSlug("-ab")).toBe(false);
    expect(isValidSlug("Ab")).toBe(false);
    expect(isValidSlug("a".repeat(63))).toBe(true);
    expect(isValidSlug("a".repeat(64))).toBe(false);
  });
});

describe("invitation tokens", () => {
  it("hash is lowercase hex SHA-256 of the UTF-8 token (same as encode(digest(p_token,'sha256'),'hex'))", () => {
    expect(hashInviteToken("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });
  it("new tokens are random, URL-safe, and only their hash is derived", () => {
    const a = newInviteToken();
    const b = newInviteToken();
    expect(a.token).not.toBe(b.token);
    expect(a.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a.hash).toBe(createHash("sha256").update(a.token).digest("hex"));
    expect(a.hash).not.toContain(a.token);
    expect(looksLikeInviteToken(a.token)).toBe(true);
    expect(looksLikeInviteToken("short")).toBe(false);
    expect(looksLikeInviteToken("x".repeat(40) + "'; drop")).toBe(false);
  });
});

describe("roles", () => {
  it("admin accepts owner and admin, never agent or junk", () => {
    expect(hasRole("owner", "admin")).toBe(true);
    expect(hasRole("admin", "admin")).toBe(true);
    expect(hasRole("agent", "admin")).toBe(false);
    expect(hasRole("superuser", "agent")).toBe(false);
    expect(hasRole(undefined, "agent")).toBe(false);
    expect(hasRole("agent", "agent")).toBe(true);
    expect(isRole("owner")).toBe(true);
  });
});

describe("active tenant selection", () => {
  const ms: TenantMembership[] = [{ id: "t-a", name: "A", role: "agent" }, { id: "t-b", name: "B", role: "admin" }];
  const user = { id: "u1", email: "u@example.test", name: "U" };
  it("honours a cookie that names a membership", () => {
    expect(pickActiveTenant(ms, "t-b")?.id).toBe("t-b");
  });
  it("ignores a forged / stale tenant id and falls back to the first membership", () => {
    expect(pickActiveTenant(ms, "t-someone-else")?.id).toBe("t-a");
    expect(pickActiveTenant(ms, "")?.id).toBe("t-a");
    expect(pickActiveTenant(ms, undefined)?.id).toBe("t-a");
  });
  it("role comes from the chosen membership (no privilege carried across tenants)", () => {
    const st = toSession(user, ms, "t-someone-else");
    expect(st.status === "ok" && st.session).toMatchObject({ tenantId: "t-a", role: "agent", tenants: ms });
    const st2 = toSession(user, ms, "t-b");
    expect(st2.status === "ok" && st2.session.role).toBe("admin");
  });
  it("no membership -> no_tenant (onboarding)", () => {
    expect(toSession(user, [], "t-a")).toEqual({ status: "no_tenant", user });
  });
});

describe("backend + cookies", () => {
  it("auth follows DATA_BACKEND (sqlite by default)", () => {
    expect(authBackend({})).toBe("sqlite");
    expect(authBackend({ DATA_BACKEND: "sqlite" })).toBe("sqlite");
    expect(authBackend({ DATA_BACKEND: " Supabase " })).toBe("supabase");
  });
  it("cookies are secure when PUBLIC_URL is https", () => {
    expect(cookieSecure({ PUBLIC_URL: "https://x.example" })).toBe(true);
    expect(cookieSecure({ PUBLIC_URL: "http://localhost:3000" })).toBe(false);
    expect(cookieSecure({ NODE_ENV: "production" })).toBe(true);
  });
});
