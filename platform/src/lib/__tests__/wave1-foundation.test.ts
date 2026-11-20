// Wave 1 helpers wave 2 builds on: Telegram webhook secret check, audit events (no PII), the team directory guard and
// the Supabase-mode seed no-op. Supabase-mode pieces run on the in-memory fake project.
import "../channels/__tests__/env-secrets";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AUDIT, auditEvent, auditSignIn } from "../audit-events";
import { authenticateTelegramWebhook, newTelegramWebhookSecret, telegramSecretMatches } from "../channels/telegram-secret";
import { getData } from "../data";
import { FakeSupabase } from "../data/__tests__/supabase-fake";
import { createSupabaseStore } from "../data/supabase";
import { AUDIT_GLOBAL_TENANT, type DataStore } from "../data/types";
import { listTeamDirectory } from "../auth/team";
import { ensureSeed } from "../seed";

describe("Telegram webhook secret", () => {
  it("random, Telegram-valid secrets; constant-time compare that fails closed", () => {
    const a = newTelegramWebhookSecret(), b = newTelegramWebhookSecret();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(telegramSecretMatches(a, a)).toBe(true);
    expect(telegramSecretMatches(a, b)).toBe(false);
    expect(telegramSecretMatches(a, a.slice(0, -1))).toBe(false);
    expect(telegramSecretMatches(a, `${a}x`)).toBe(false);
    expect(telegramSecretMatches(a, "")).toBe(false);
    expect(telegramSecretMatches(a, null)).toBe(false);
    expect(telegramSecretMatches(null, null)).toBe(false);
    expect(telegramSecretMatches("", "")).toBe(false);
    expect(telegramSecretMatches(undefined, a)).toBe(false);
    expect(telegramSecretMatches(a, "x".repeat(10_000))).toBe(false);
  });

  it("authenticateTelegramWebhook: routing id + encrypted secret, never another tenant", async () => {
    const data = getData();
    const A = await data.tenants.ensure(`tga-${randomUUID()}`, "A"), B = await data.tenants.ensure(`tgb-${randomUUID()}`, "B");
    const secretA = newTelegramWebhookSecret(), secretB = newTelegramWebhookSecret();
    await data.channels.save(A, "telegram", { status: "connected", publicInfo: { externalId: `bot-${A}` } });
    await data.secrets.set(A, "channel", "telegram", { botToken: "1:A", webhookSecret: secretA });
    await data.channels.save(B, "telegram", { status: "connected", publicInfo: { externalId: `bot-${B}` } });
    await data.secrets.set(B, "channel", "telegram", { botToken: "1:B", webhookSecret: secretB });
    const hookA = (await data.channels.get(A, "telegram")).webhookId!;
    const hookB = (await data.channels.get(B, "telegram")).webhookId!;

    expect(await authenticateTelegramWebhook(hookA, secretA)).toEqual({ tenantId: A });
    expect(await authenticateTelegramWebhook(hookA, secretB)).toBeNull(); // B's secret on A's URL
    expect(await authenticateTelegramWebhook(hookB, secretA)).toBeNull();
    expect(await authenticateTelegramWebhook(hookA, null)).toBeNull();
    expect(await authenticateTelegramWebhook(randomUUID(), secretA)).toBeNull();
    await data.channels.save(A, "telegram", { status: "disconnected", publicInfo: {} });
    expect(await authenticateTelegramWebhook(hookA, secretA)).toBeNull();
    await data.secrets.clear(B, "channel", "telegram");
    expect(await authenticateTelegramWebhook(hookB, secretB)).toBeNull(); // no stored secret: fail closed
  });
});

describe("audit events", () => {
  it("sign-in rows carry the hashed IP only, per membership tenant; failures are global", async () => {
    const data = getData();
    const T = await data.tenants.ensure(`au-${randomUUID()}`, "Audit");
    await auditSignIn({ ok: true, userId: "u-1", tenantIds: [T] }, "203.0.113.7");
    const rows = await data.audit.list(T, { action: AUDIT.loginOk });
    expect(rows).toHaveLength(1);
    expect(rows[0].actor).toBe("u-1");
    expect(rows[0].detail).not.toContain("203.0.113.7");
    expect(rows[0].detail).toMatch(/^login-ip:[A-Za-z0-9_-]{32}$/);
    await auditSignIn({ ok: false }, "203.0.113.7");
    expect((await data.audit.list(AUDIT_GLOBAL_TENANT, { action: AUDIT.loginFailed })).every((r) => !r.detail.includes("203.0.113.7"))).toBe(true);
  });

  it("auditEvent never throws (an audit failure must not break the user's action)", async () => {
    const g = globalThis as { __dataStore?: DataStore };
    const saved = g.__dataStore;
    g.__dataStore = { ...saved!, audit: { ...saved!.audit, log: async () => { throw new Error("db down"); } } };
    await expect(auditEvent("t", "u", AUDIT.roleChanged, "x")).resolves.toBeUndefined();
    g.__dataStore = saved;
  });
});

describe("Supabase mode (fake project)", () => {
  const g = globalThis as { __dataStore?: DataStore };
  let saved: DataStore | undefined; let fake: FakeSupabase; let store: DataStore;
  beforeEach(() => {
    fake = new FakeSupabase(); store = createSupabaseStore(fake); saved = g.__dataStore;
    g.__dataStore = store; process.env.DATA_BACKEND = "supabase";
  });
  afterEach(() => { delete process.env.DATA_BACKEND; g.__dataStore = saved; });

  it("team directory: real names/emails of the ACTIVE tenant only, after the membership check", async () => {
    const A = await store.tenants.ensure(`ta-${randomUUID()}`, "A"), B = await store.tenants.ensure(`tb-${randomUUID()}`, "B");
    const me = fake.addMember(A, { email: "ana@a.test", name: "Ana", role: "owner" });
    const lu = fake.addMember(A, { email: "lu@a.test", name: "Lu", role: "agent" });
    fake.addMember(B, { email: "bo@b.test", name: "Bo", role: "owner" });
    const session = { tenantId: A, role: "agent" as const, tenants: [{ id: A, name: "A", role: "agent" as const }] };
    const dir = await listTeamDirectory(session);
    expect(dir.map((m) => [m.userId, m.name, m.email, m.role]).sort()).toEqual([[me, "Ana", "ana@a.test", "owner"], [lu, "Lu", "lu@a.test", "agent"]].sort());
    // A session whose active tenant is not one of its memberships is refused (no cross-tenant directory).
    await expect(listTeamDirectory({ tenantId: B, role: "agent", tenants: [{ id: A, name: "A", role: "agent" }] })).rejects.toThrow("forbidden");
  });

  it("ensureSeed is a no-op: no local user, tenant or password is created", async () => {
    process.env.ADMIN_EMAIL = "seed@example.test"; process.env.ADMIN_PASSWORD = "seed-password-123";
    const before = fake.log.length;
    await ensureSeed();
    expect(fake.log.length).toBe(before);
    expect(fake.tables.tenants).toEqual([]);
    delete process.env.ADMIN_EMAIL; delete process.env.ADMIN_PASSWORD;
  });

  it("global audit rows have tenant_id NULL (service role only)", async () => {
    await auditSignIn({ ok: false }, "198.51.100.1");
    const row = fake.tables.audit_log.find((r) => r.action === AUDIT.loginFailed);
    expect(row).toMatchObject({ tenant_id: null, actor: "anonymous" });
    expect(String(row!.detail)).not.toContain("198.51.100.1");
  });
});
