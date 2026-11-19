// Cross-tenant negative test for the DataStore (AGENTS.md: every tenant-owned query is tenant scoped).
// Tenant B's rows are created first; every sub-repo method that takes tenantId is then called AS TENANT A with B's
// ids / keys, and must neither return B's data nor change it.
import "../../channels/__tests__/env-secrets";
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { getData } from "..";
import type { DataStore } from "../types";

let data: DataStore;
let A: string, B: string;
let bConv: string, bMsg: string, bSource: string;

const PURGE = { cutoff: "2999-01-01T00:00:00.000Z", maskCutoff: "2999-01-01T00:00:00.000Z", maskedBody: "[masked]" };

beforeEach(async () => {
  data = getData();
  A = `tA-${randomUUID()}`; B = `tB-${randomUUID()}`;
  await data.tenants.ensure(A, "Tenant A");
  await data.tenants.ensure(B, "Tenant B");
  await data.users.create({ tenantId: B, email: `b-${B}@example.test`, name: "B admin", passwordHash: "x:y" });

  await data.settings.save(B, { agentName: "Bot B", handoffEmail: "ops@b.test", toneLevel: 5 });
  await data.settings.markToneSaved(B, "user-b");
  await data.brand.save(B, { displayName: "Brand B", primaryColor: "#112233" });
  await data.sections.saveContent(B, "warranty", "Garantía secreta de B");
  const src = await data.sources.create(B, { kind: "link", title: "Fuente B", url: "https://b.example/x" });
  bSource = src.id;
  await data.sources.updateStatus(B, bSource, "indexed", undefined, "texto de B");
  await data.sections.setFile(B, "faq", bSource);
  await data.sections.setMode(B, "faq", "file");
  await data.sections.link(B, "products", bSource);
  await data.chunks.replace(B, { sourceId: bSource }, [{ title: "B", text: "chunk de B" }]);
  await data.chunks.replaceSection(B, "warranty", [{ sourceId: null, title: "Garantía", text: "garantía de B" }]);
  const conv = await data.conversations.getOrCreate(B, "whatsapp", "5215500000000", "Cliente B");
  bConv = conv.id;
  await data.conversations.setStatus(B, bConv, "needs_human", "safety");
  await data.conversations.setState(B, bConv, { misses: 3, offer: { reason: "no_answer" } });
  const msg = await data.messages.add(B, bConv, { direction: "in", sender: "customer", body: "hola soy B", providerMessageId: "wamid.B1" });
  bMsg = msg.id;
  await data.addons.save(B, "shopify", { status: "connected", publicInfo: { shop: "b.myshopify.com" } });
  await data.secrets.set(B, "addon", "shopify", { shop: "b.myshopify.com", accessToken: "shpat_B" });
  await data.channels.save(B, "whatsapp", { status: "connected", publicInfo: { externalId: `phone-${B}` } });
  await data.secrets.set(B, "channel", "whatsapp", { accessToken: "EAAG-B" });
  await data.audit.log(B, "user-b", "test.action", "detail-b");
  await data.usage.record(B, { inputTokens: 100, outputTokens: 50 });
  await data.limiter.recordLookupFailure(B, "order-hash-b", "email-hash-b", Date.now(), 0);
});

describe("tenant A cannot read tenant B through any sub-repo", () => {
  it("settings / brand / members", async () => {
    expect((await data.settings.get(A)).agentName).not.toBe("Bot B");
    expect(await data.settings.isToneSaved(A)).toBe(false);
    expect((await data.brand.get(A)).displayName).toBe("Tenant A");
    expect((await data.brand.get(A)).primaryColor).toBe("#0F766E");
    expect(await data.members.list(A)).toEqual([]);
    expect((await data.members.list(B)).map((m) => m.tenantId)).toEqual([B]);
  });

  it("knowledge: sections, sources, chunks", async () => {
    expect((await data.sections.list(A)).every((s) => s.content === "")).toBe(true);
    expect(await data.sections.getRow(A, "warranty")).toBeNull();
    expect((await data.sections.listRows(A)).every((r) => r.fileSourceId === null && r.mode === "text")).toBe(true);
    expect(await data.sections.listLinks(A)).toEqual([]);
    expect(await data.sections.sectionsForSource(A, bSource)).toEqual([]);
    expect(await data.sources.list(A)).toEqual([]);
    expect(await data.sources.get(A, bSource)).toBeNull();
    expect(await data.sources.getText(A, bSource)).toBeNull();
    expect(await data.sources.exists(A, bSource)).toBe(false);
    expect(await data.chunks.list(A)).toEqual([]);
  });

  it("inbox: conversations and messages", async () => {
    expect(await data.conversations.get(A, bConv)).toBeNull();
    expect(await data.conversations.list(A)).toEqual([]);
    expect(await data.conversations.findIdByExternal(A, "whatsapp", "5215500000000")).toBeNull();
    expect(await data.conversations.listIdsByExternalPrefix(A, "521")).toEqual([]);
    expect(await data.conversations.countByStatus(A)).toEqual({ bot: 0, needs_human: 0, human: 0, resolved: 0 });
    expect(await data.messages.list(A, bConv)).toEqual([]);
    expect(await data.messages.recent(A, bConv, 10)).toEqual([]);
    expect((await data.messages.latest(A, [bConv])).size).toBe(0);
    expect(await data.messages.lastInboundAt(A, bConv)).toBeNull();
    expect(await data.messages.hasProviderMessage(A, bConv, "wamid.B1")).toBe(false);
    // Same external id under tenant A is a NEW conversation, never B's.
    const mine = await data.conversations.getOrCreate(A, "whatsapp", "5215500000000");
    expect(mine.id).not.toBe(bConv);
    expect(mine.tenantId).toBe(A);
  });

  it("add-ons, channels and secrets", async () => {
    expect((await data.addons.get(A, "shopify")).status).toBe("disconnected");
    expect((await data.channels.get(A, "whatsapp")).status).toBe("disconnected");
    expect(await data.secrets.get(A, "addon", "shopify")).toBeNull();
    expect(await data.secrets.get(A, "channel", "whatsapp")).toBeNull();
  });

  it("audit, usage, limiter, retention lookups", async () => {
    expect(await data.audit.find(A, { action: "test.action" })).toBeNull();
    expect(await data.audit.list(A)).toEqual([]);
    expect((await data.usage.get(A)).inputTokens).toBe(0);
    expect(await data.limiter.countLookupFailures(A, 0)).toBe(0);
    expect(await data.limiter.countLookupFailures(A, 0, { orderHash: "order-hash-b" })).toBe(0);
    expect(await data.retention.findCustomerConversations(A, "whatsapp", "5215500000000")).toEqual([]);
    expect(await data.retention.exportMessages(A, bConv)).toEqual([]);
  });
});

describe("tenant A cannot change tenant B through any sub-repo", () => {
  it("writes with B's ids / keys leave B untouched", async () => {
    await data.settings.save(A, { agentName: "Bot A" });
    await data.brand.save(A, { displayName: "Brand A" });
    await data.sections.saveContent(A, "warranty", "texto de A");
    await data.sections.setMode(A, "faq", "text");
    await data.sections.setFile(A, "faq", null);
    expect(await data.sections.link(A, "extra", bSource)).toBe(false); // cross-tenant source id refused
    await data.sections.unlink(A, "products", bSource);
    expect(await data.sections.removeSourceReferences(A, bSource)).toEqual([]);
    await data.sources.updateStatus(A, bSource, "error", "hacked", "texto de A");
    await data.sources.delete(A, bSource);
    await data.chunks.replace(A, { sourceId: bSource }, []);
    await data.chunks.replaceSection(A, "warranty", []);
    await data.chunks.deleteGeneralForSource(A, bSource);
    await data.conversations.setStatus(A, bConv, "resolved", "x");
    await data.conversations.setState(A, bConv, {});
    await data.conversations.markRead(A, bConv);
    await data.conversations.resetForBot(A, bConv);
    await data.conversations.setTimestamps(A, bConv, { unread: 99, lastMessageAt: "2000-01-01T00:00:00.000Z" });
    expect(await data.conversations.delete(A, bConv)).toEqual({ conversations: 0, messages: 0 });
    await data.messages.setCreatedAt(A, bMsg, "2000-01-01T00:00:00.000Z");
    await data.addons.save(A, "shopify", { status: "disconnected" });
    await data.secrets.clear(A, "addon", "shopify");
    await data.secrets.clear(A, "channel", "whatsapp");
    await data.channels.save(A, "whatsapp", { status: "disconnected", publicInfo: {} });
    expect(await data.audit.deleteByActor(A, "user-b")).toBe(0);
    expect(await data.retention.deleteConversations(A, [bConv])).toEqual({ conversations: 0, messages: 0 });
    expect(await data.retention.purgeTenant(A, PURGE)).toMatchObject({ messagesDeleted: 0, conversationsDeleted: 0, messagesMasked: 0 });

    // B is exactly as before.
    expect((await data.settings.get(B)).agentName).toBe("Bot B");
    expect(await data.settings.isToneSaved(B)).toBe(true);
    expect((await data.brand.get(B)).displayName).toBe("Brand B");
    expect((await data.sections.getRow(B, "warranty"))?.content).toBe("Garantía secreta de B");
    expect(await data.sections.getRow(B, "faq")).toMatchObject({ mode: "file", fileSourceId: bSource });
    expect(await data.sections.listLinks(B)).toEqual([{ sectionKey: "products", sourceId: bSource }]);
    expect(await data.sources.getText(B, bSource)).toMatchObject({ status: "indexed", error: null, text: "texto de B" });
    const chunks = await data.chunks.list(B);
    expect(chunks.map((c) => c.text).sort()).toEqual(["chunk de B", "garantía de B"]);
    const conv = await data.conversations.get(B, bConv);
    expect(conv).toMatchObject({ status: "needs_human", escalationReason: "safety", unread: 1, state: { misses: 3, offer: { reason: "no_answer" } } });
    expect(conv!.lastMessageAt).not.toBe("2000-01-01T00:00:00.000Z");
    const msgs = await data.messages.list(B, bConv);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatchObject({ body: "hola soy B", providerMessageId: "wamid.B1" });
    expect(msgs[0].createdAt).not.toBe("2000-01-01T00:00:00.000Z");
    expect((await data.addons.get(B, "shopify")).status).toBe("connected");
    expect(await data.secrets.get(B, "addon", "shopify")).toEqual({ shop: "b.myshopify.com", accessToken: "shpat_B" });
    expect(await data.secrets.get(B, "channel", "whatsapp")).toEqual({ accessToken: "EAAG-B" });
    expect((await data.channels.get(B, "whatsapp")).status).toBe("connected");
    expect(await data.audit.find(B, { action: "test.action" })).toBe("detail-b");
    expect((await data.usage.get(B)).inputTokens).toBe(100);
    expect(await data.limiter.countLookupFailures(B, 0)).toBe(1);
  });

  it("tenant A's usage/limiter writes never count for B", async () => {
    await data.usage.record(A, { inputTokens: 7, outputTokens: 3 });
    await data.limiter.recordLookupFailure(A, "order-hash-b", "email-hash-b", Date.now(), 0);
    expect(await data.limiter.recordInbound(A, bConv, Date.now(), 0, 0)).toBe(1);
    expect(await data.limiter.recordInbound(B, bConv, Date.now(), 0, 0)).toBe(1);
    expect((await data.usage.get(B)).inputTokens).toBe(100);
    expect(await data.limiter.countLookupFailures(B, 0, { orderHash: "order-hash-b" })).toBe(1);
  });
});
