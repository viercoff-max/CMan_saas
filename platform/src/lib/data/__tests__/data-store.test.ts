// DataStore entry point and SQLite-only behaviour: backend selection, the local users table (until Supabase Auth).
// Backend-neutral behaviour lives in data-store-contract.ts (run by tenant-isolation.test.ts and the Supabase tests).
import "../../channels/__tests__/env-secrets";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { dataBackend, getData } from "..";

describe("backend selection", () => {
  const saved = { url: process.env.NEXT_PUBLIC_SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY };
  afterEach(() => {
    delete process.env.DATA_BACKEND;
    if (saved.url === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = saved.url;
    if (saved.key === undefined) delete process.env.SUPABASE_SECRET_KEY; else process.env.SUPABASE_SECRET_KEY = saved.key;
  });

  it("defaults to sqlite", () => {
    expect(dataBackend({})).toBe("sqlite");
    expect(dataBackend({ DATA_BACKEND: " SQLite " })).toBe("sqlite");
    expect(getData().backend).toBe("sqlite");
  });
  it("supabase fails clearly when the server env vars are missing (and never echoes a key)", () => {
    expect(dataBackend({ DATA_BACKEND: "supabase" })).toBe("supabase");
    process.env.DATA_BACKEND = "supabase";
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.SUPABASE_SECRET_KEY = "sb_secret_must_not_leak";
    let msg = "";
    try { getData(); } catch (e) { msg = (e as Error).message; }
    expect(msg).toMatch(/NEXT_PUBLIC_SUPABASE_URL/);
    expect(msg).not.toMatch(/SUPABASE_SECRET_KEY/); // only the missing one is named
    expect(msg).not.toContain("sb_secret_must_not_leak");
    delete process.env.SUPABASE_SECRET_KEY;
    expect(() => getData()).toThrow(/NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY/);
    delete process.env.DATA_BACKEND;
    expect(getData().backend).toBe("sqlite"); // a failed switch does not break the cached store
  });
  it("supabase with env vars builds the store (no network until a query runs)", () => {
    process.env.DATA_BACKEND = "supabase";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example-project.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_offline_test_value";
    expect(getData().backend).toBe("supabase");
    delete process.env.DATA_BACKEND;
    expect(getData().backend).toBe("sqlite");
  });
  it("rejects unknown backends", () => {
    expect(() => dataBackend({ DATA_BACKEND: "mysql" })).toThrow(/Unknown DATA_BACKEND/);
  });
});

describe("users (local auth until Supabase Auth)", () => {
  it("login lookup returns the hash only through findLoginByEmail; profiles never carry it", async () => {
    const d = getData(); const t = `t-${randomUUID()}`; const email = `u-${randomUUID()}@example.test`;
    const id = await d.users.create({ tenantId: t, email, name: "Ana", passwordHash: "salt:hash" });
    expect(await d.users.findLoginByEmail(email)).toEqual({ id, tenantId: t, passwordHash: "salt:hash" });
    const profile = await d.users.get(id);
    expect(profile).toEqual({ id, tenantId: t, name: "Ana", email });
    expect(JSON.stringify(await d.members.list(t))).not.toContain("salt:hash");
    expect(await d.users.setPasswordHash(id, "salt2:hash2")).toBe(true);
    expect((await d.users.findLoginByEmail(email))?.passwordHash).toBe("salt2:hash2");
    expect(await d.users.setPasswordHash("nope", "x")).toBe(false);
  });
});
