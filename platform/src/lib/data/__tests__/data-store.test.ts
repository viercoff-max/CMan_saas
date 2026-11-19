// Behaviour of the DataStore interface itself (SQLite backend): backend selection, secrets isolation from UI-facing
// reads, brand validation, AI usage per month, provider message id, channel ownership conflict.
import "../../channels/__tests__/env-secrets";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { DataBackendNotImplementedError, DataConflictError, DataValidationError, dataBackend, getData } from "..";

const tid = () => `t-${randomUUID()}`;

describe("backend selection", () => {
  afterEach(() => { delete process.env.DATA_BACKEND; });

  it("defaults to sqlite", () => {
    expect(dataBackend({})).toBe("sqlite");
    expect(dataBackend({ DATA_BACKEND: " SQLite " })).toBe("sqlite");
    expect(getData().backend).toBe("sqlite");
  });
  it("supabase is reserved and fails clearly", () => {
    expect(dataBackend({ DATA_BACKEND: "supabase" })).toBe("supabase");
    process.env.DATA_BACKEND = "supabase";
    expect(() => getData()).toThrow(DataBackendNotImplementedError);
    expect(() => getData()).toThrow(/not implemented yet/);
  });
  it("rejects unknown backends", () => {
    expect(() => dataBackend({ DATA_BACKEND: "mysql" })).toThrow(/Unknown DATA_BACKEND/);
  });
});

describe("secrets", () => {
  it("are never part of addon / channel reads and survive status changes until cleared", async () => {
    const d = getData(); const t = tid();
    await d.secrets.set(t, "addon", "shopify", { shop: "s.myshopify.com", accessToken: "shpat_secret" });
    await d.addons.save(t, "shopify", { status: "connected", publicInfo: { shop: "s.myshopify.com" } });
    const addon = await d.addons.get(t, "shopify");
    expect(addon.status).toBe("connected");
    expect(addon.connectedAt).toBeTruthy();
    expect(JSON.stringify(addon)).not.toContain("shpat_secret");
    // Re-saving the status keeps the secrets; disconnecting wipes them.
    await d.addons.save(t, "shopify", { status: "connected", publicInfo: { shop: "s.myshopify.com", name: "S" } });
    expect(await d.secrets.get(t, "addon", "shopify")).toMatchObject({ accessToken: "shpat_secret" });
    await d.addons.save(t, "shopify", { status: "disconnected" });
    expect(await d.secrets.get(t, "addon", "shopify")).toBeNull();

    await d.channels.save(t, "telegram", { status: "connected", publicInfo: { externalId: `bot-${t}` } });
    await d.secrets.set(t, "channel", "telegram", { botToken: "123:ABC" });
    const ch = await d.channels.get(t, "telegram");
    expect(ch).toEqual({ channel: "telegram", status: "connected", publicInfo: { externalId: `bot-${t}` } });
    expect(JSON.stringify(ch)).not.toContain("123:ABC");
    await d.channels.save(t, "telegram", { status: "disconnected", publicInfo: {} });
    expect(await d.secrets.get(t, "channel", "telegram")).toEqual({ botToken: "123:ABC" }); // channels keep them...
    await d.secrets.clear(t, "channel", "telegram"); // ...until explicitly cleared (disconnect action does this)
    expect(await d.secrets.get(t, "channel", "telegram")).toBeNull();
  });

  it("are stored encrypted (no plain token in the row)", async () => {
    const d = getData(); const t = tid();
    await d.secrets.set(t, "channel", "whatsapp", { accessToken: "EAAG-plain-check" });
    const { getDb } = await import("../../db"); // fixture inspection only
    const row = getDb().prepare("SELECT config_enc FROM channel_accounts WHERE tenant_id=?").get(t) as { config_enc: string };
    expect(row.config_enc).toBeTruthy();
    expect(row.config_enc).not.toContain("EAAG-plain-check");
  });
});

describe("channels", () => {
  it("one external account belongs to one tenant: DataConflictError, and routing finds the owner", async () => {
    const d = getData(); const a = tid(), b = tid(); const ext = `page-${randomUUID()}`;
    await d.channels.save(a, "messenger", { status: "connected", publicInfo: { externalId: ext } });
    await expect(d.channels.save(b, "messenger", { status: "connected", publicInfo: { externalId: ext } })).rejects.toBeInstanceOf(DataConflictError);
    expect(await d.channels.findTenantByExternalId("messenger", ext)).toBe(a);
    expect((await d.channels.get(b, "messenger")).status).toBe("disconnected");
  });
});

describe("messages", () => {
  it("providerMessageId is stored, mapped and used for inbound dedupe", async () => {
    const d = getData(); const t = tid();
    const c = await d.conversations.getOrCreate(t, "telegram", "chat-1", "Ana");
    const m = await d.messages.add(t, c.id, { direction: "in", sender: "customer", body: "hola", meta: { media: "photo" }, providerMessageId: "tg-77" });
    expect(m).toMatchObject({ providerMessageId: "tg-77", meta: { media: "photo", providerMessageId: "tg-77" } });
    expect(await d.messages.hasProviderMessage(t, c.id, "tg-77")).toBe(true);
    expect(await d.messages.hasProviderMessage(t, c.id, "tg-78")).toBe(false);
    const out = await d.messages.add(t, c.id, { direction: "out", sender: "bot", body: "¡hola!" });
    expect(out.providerMessageId).toBeNull();
    expect((await d.conversations.get(t, c.id))?.unread).toBe(1);
  });
});

describe("brand settings", () => {
  it("defaults like Supabase, saves a patch, validates like the CHECK constraints", async () => {
    const d = getData(); const t = tid();
    await d.tenants.ensure(t, "Mi Marca");
    expect(await d.brand.get(t)).toMatchObject({
      displayName: "Mi Marca", logoPath: null, primaryColor: "#0F766E", accentColor: "#14181F", menuBgColor: "#F6F7F9", headingFont: "system", updatedAt: null,
    });
    const saved = await d.brand.save(t, { primaryColor: "#aa00FF", headingFont: "Inter", logoPath: `${t}/logo.png` });
    expect(saved).toMatchObject({ displayName: "Mi Marca", primaryColor: "#aa00FF", headingFont: "Inter", logoPath: `${t}/logo.png` });
    expect(saved.updatedAt).toBeTruthy();
    await expect(d.brand.save(t, { primaryColor: "red" })).rejects.toBeInstanceOf(DataValidationError);
    await expect(d.brand.save(t, { headingFont: "Inter; } body { x" })).rejects.toBeInstanceOf(DataValidationError);
    await expect(d.brand.save(t, { displayName: "x".repeat(121) })).rejects.toBeInstanceOf(DataValidationError);
    expect((await d.brand.get(t)).primaryColor).toBe("#aa00FF");
  });
});

describe("AI usage", () => {
  it("accumulates requests and tokens per tenant and calendar month (UTC)", async () => {
    const d = getData(); const t = tid();
    await d.usage.record(t, { inputTokens: 120, outputTokens: 30 }, new Date("2026-11-03T10:00:00Z"));
    const r = await d.usage.record(t, { inputTokens: 80, outputTokens: 20 }, new Date("2026-11-30T23:59:00Z"));
    expect(r).toEqual({ tenantId: t, period: "2026-11-01", requests: 2, inputTokens: 200, outputTokens: 50 });
    await d.usage.record(t, { requests: 1, inputTokens: 5 }, new Date("2026-12-01T00:00:00Z"));
    expect(await d.usage.get(t, "2026-11-01")).toMatchObject({ requests: 2, inputTokens: 200 });
    expect(await d.usage.get(t, "2026-12-01")).toMatchObject({ requests: 1, inputTokens: 5, outputTokens: 0 });
    expect(await d.usage.record(t, { inputTokens: -50 }, new Date("2026-12-02T00:00:00Z"))).toMatchObject({ inputTokens: 5 });
  });
});

describe("users (local auth until Supabase Auth)", () => {
  it("login lookup returns the hash only through findLoginByEmail; profiles never carry it", async () => {
    const d = getData(); const t = tid(); const email = `u-${randomUUID()}@example.test`;
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
