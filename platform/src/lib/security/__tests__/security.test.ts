import "../../retention/__tests__/env";
import { beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, { value: string; opts?: Record<string, unknown> }>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { value: jar.get(k)!.value } : undefined),
    set: (k: string, value: string, opts?: Record<string, unknown>) => { jar.set(k, { value, opts }); },
    delete: (k: string) => { jar.delete(k); },
  }),
}));

import { getDb } from "../../db";
import { assertSameOrigin, checkSameOrigin } from "../origin";
import { contentMatchesExt, mimeMatchesExt } from "../upload";
import { hit } from "../rate-limit";
import { cookieSecure, hashPassword, login, verifyPassword } from "../../auth";
import { assertSafeUrl, isPrivateIp, UnsafeUrlError } from "../../context/fetch-safe";

const req = (method: string, headers: Record<string, string>, url = "http://localhost:3000/api/x") => new Request(url, { method, headers });

describe("assertSameOrigin", () => {
  it("allows same-origin POST (Host or PUBLIC_URL)", () => {
    expect(checkSameOrigin(req("POST", { host: "localhost:3000", origin: "http://localhost:3000" }))).toBeNull();
    expect(checkSameOrigin(req("POST", { host: "localhost:3000", origin: "https://inbox.test" }))).toBeNull();
  });
  it("rejects another origin, another localhost port, Origin null and cross-site fetch metadata", () => {
    for (const h of <Record<string, string>[]>[
      { host: "localhost:3000", origin: "https://evil.example" },
      { host: "localhost:3000", origin: "http://localhost:5173" },
      { host: "localhost:3000", origin: "null" },
      { host: "localhost:3000", origin: "http://localhost:3000", "sec-fetch-site": "same-site" },
    ]) expect(checkSameOrigin(req("POST", h))?.status).toBe(403);
  });
  it("missing Origin: OK for GET/HEAD, POST needs a same-origin Referer", () => {
    expect(checkSameOrigin(req("GET", { host: "localhost:3000" }))).toBeNull();
    expect(checkSameOrigin(req("HEAD", { host: "localhost:3000" }))).toBeNull();
    expect(checkSameOrigin(req("POST", { host: "localhost:3000" }))?.status).toBe(403);
    expect(checkSameOrigin(req("DELETE", { host: "localhost:3000", referer: "https://evil.example/x" }))?.status).toBe(403);
    expect(checkSameOrigin(req("POST", { host: "localhost:3000", referer: "http://localhost:3000/addons" }))).toBeNull();
  });
  it("assertSameOrigin throws a 403 Response", () => {
    let thrown: unknown;
    try { assertSameOrigin(req("POST", { host: "localhost:3000", origin: "https://evil.example" })); } catch (e) { thrown = e; }
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(403);
  });
});

describe("upload checks", () => {
  it("MIME must fit the extension (lenient for empty/octet-stream and Windows csv)", () => {
    expect(mimeMatchesExt("application/pdf", "pdf")).toBe(true);
    expect(mimeMatchesExt("", "md")).toBe(true);
    expect(mimeMatchesExt("application/vnd.ms-excel", "csv")).toBe(true);
    expect(mimeMatchesExt("application/x-msdownload", "pdf")).toBe(false);
    expect(mimeMatchesExt("text/html", "docx")).toBe(false);
  });
  it("magic bytes", () => {
    expect(contentMatchesExt(Buffer.from("%PDF-1.7\n..."), "pdf")).toBe(true);
    expect(contentMatchesExt(Buffer.from("MZ\x90\x00"), "pdf")).toBe(false);
    expect(contentMatchesExt(Buffer.from([0x50, 0x4b, 0x03, 0x04, 1]), "docx")).toBe(true);
    expect(contentMatchesExt(Buffer.from("%PDF-"), "docx")).toBe(false);
    expect(contentMatchesExt(Buffer.from("a,b\n1,2"), "csv")).toBe(true);
    expect(contentMatchesExt(Buffer.from([0x41, 0x00, 0x42]), "txt")).toBe(false);
  });
});

describe("rate limiter", () => {
  it("fixed window", () => {
    const now = 1_000_000;
    for (let i = 0; i < 3; i++) expect(hit("k-test", 3, 60_000, now + i).ok).toBe(true);
    const r = hit("k-test", 3, 60_000, now + 10);
    expect(r.ok).toBe(false);
    expect(r.retryAfterS).toBeGreaterThan(0);
    expect(hit("k-test", 3, 60_000, now + 61_000).ok).toBe(true);
  });
});

describe("login hardening", () => {
  beforeEach(() => {
    jar.clear();
    const db = getDb();
    db.exec("DELETE FROM users; DELETE FROM audit_log;");
    try { db.exec("DELETE FROM login_attempts"); } catch { /* created lazily */ }
    db.prepare("INSERT INTO users (id, tenant_id, email, name, password_hash) VALUES (?,?,?,?,?)")
      .run("u1", "t1", "admin@example.test", "Admin", hashPassword("correct horse battery"));
  });

  it("verifyPassword is async and correct", async () => {
    const h = hashPassword("pw-123456");
    await expect(verifyPassword("pw-123456", h)).resolves.toBe(true);
    await expect(verifyPassword("nope", h)).resolves.toBe(false);
  });

  it("same response for unknown email and wrong password; success sets a session cookie", async () => {
    expect(await login("nobody@example.test", "x", "1.1.1.1")).toEqual({ ok: false });
    expect(await login("admin@example.test", "wrong", "1.1.1.1")).toEqual({ ok: false });
    expect(jar.has("session")).toBe(false);
    expect(await login("ADMIN@example.test ", "correct horse battery", "1.1.1.1")).toEqual({ ok: true });
    expect(jar.get("session")?.opts).toMatchObject({ httpOnly: true, sameSite: "lax", secure: true }); // PUBLIC_URL is https
  });

  it("locks an email after 5 failures in 15 min, even with the right password; audit has no password/email", async () => {
    for (let i = 0; i < 5; i++) await login("admin@example.test", `bad-${i}`, `10.0.0.${i}`);
    expect(await login("admin@example.test", "correct horse battery", "10.0.0.99")).toEqual({ ok: false });
    const details = (getDb().prepare("SELECT action, detail FROM audit_log").all() as { action: string; detail: string }[]);
    expect(details.some((d) => d.action === "auth.login_locked")).toBe(true);
    for (const d of details) {
      expect(d.detail).not.toContain("admin@example.test");
      expect(d.detail).not.toContain("correct horse");
      expect(d.detail).not.toContain("bad-");
    }
  });

  it("locks an IP after 10 failures across emails", async () => {
    for (let i = 0; i < 10; i++) await login(`u${i}@example.test`, "x", "9.9.9.9");
    expect(await login("admin@example.test", "correct horse battery", "9.9.9.9")).toEqual({ ok: false });
    expect(await login("admin@example.test", "correct horse battery", "8.8.8.8")).toEqual({ ok: true });
  });

  it("Secure cookie follows PUBLIC_URL scheme", () => {
    const prev = process.env.PUBLIC_URL;
    process.env.PUBLIC_URL = "http://localhost:3000";
    expect(cookieSecure()).toBe(process.env.NODE_ENV === "production");
    process.env.PUBLIC_URL = "https://x.trycloudflare.com";
    expect(cookieSecure()).toBe(true);
    process.env.PUBLIC_URL = prev;
  });
});

describe("fetch-safe additions (REVIEW-security L1)", () => {
  it("blocks site-local, Teredo and local-use NAT64", () => {
    expect(isPrivateIp("fec0::1")).toBe(true);
    expect(isPrivateIp("2001:0:4136:e378:8000:63bf:3fff:fdd2")).toBe(true);
    expect(isPrivateIp("64:ff9b:1::a00:1")).toBe(true);
    expect(isPrivateIp("2001:4860:4860::8888")).toBe(false);
  });
  it("allows only standard web ports", async () => {
    const pub = async () => ["93.184.216.34"];
    await expect(assertSafeUrl("https://example.com/x", pub)).resolves.toBeInstanceOf(URL);
    await expect(assertSafeUrl("https://example.com:8443/x", pub)).resolves.toBeInstanceOf(URL);
    await expect(assertSafeUrl("http://example.com:6379/", pub)).rejects.toBeInstanceOf(UnsafeUrlError);
    await expect(assertSafeUrl("http://example.com:22/", pub)).rejects.toMatchObject({ code: "bad_port" });
  });
});
