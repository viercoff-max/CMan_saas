// The DataStore CONTRACT: one set of behavioural assertions every backend must pass. Not a test file itself
// (no .test.ts suffix): it is run by
//   * tenant-isolation.test.ts          -> SQLite (every `npm test`)
//   * supabase-backend.test.ts          -> Supabase store on the in-memory query-builder fake (every `npm test`)
//   * supabase-contract-live.test.ts    -> Supabase store on a REAL project (RUN_LIVE=1 only; excluded by *-live)
// Part 1 is the cross-tenant negative test (AGENTS.md): tenant B's rows are created first; every sub-repo method
// that takes tenantId is then called AS TENANT A with B's ids / keys, and must neither return B's data nor change it.
import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { DataConflictError, DataValidationError } from "../errors";
import { SUPABASE_FREE_TOKEN_CAP, TENANT_DEFAULTS } from "../rules";
import { AUDIT_GLOBAL_TENANT, type DataStore, type SecretKind } from "../types";

export interface ContractTarget {
  name: string;
  store: () => DataStore;
  /** The stored secret exactly as persisted (ciphertext), to prove nothing is stored in plain text. */
  rawSecret: (tenantId: string, kind: SecretKind, key: string) => Promise<string | null>;
  /** Adds a team member to a tenant (returns its user id), or undefined when the target cannot create users. */
  addMember?: (tenantId: string, email: string, name: string) => Promise<string>;
  /** Creates two members of `tenantId` and makes ONLY the first a platform admin (undefined: checks skipped). */
  makePlatformAdmin?: (tenantId: string) => Promise<{ admin: string; other: string }>;
  /** Platform action (SQL today): sets tenants.status. */
  setTenantStatus: (tenantId: string, status: "active" | "suspended" | "deleted") => Promise<void>;
}
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const PURGE_NOOP = { cutoff: "2999-01-01T00:00:00.000Z", maskCutoff: "2999-01-01T00:00:00.000Z", maskedBody: "[masked]" };
/** Valid as a SQLite tenant id AND as a Supabase tenant slug. */
export const tenantKey = (p: string) => `${p}-${randomUUID()}`;
const OLD = "2000-01-01T00:00:00.000Z";

export function defineDataStoreContract(t: ContractTarget): void {
  describe(`DataStore contract [${t.name}]`, () => {
    let data: DataStore;
    const newTenant = async (p: string, name = p) => data.tenants.ensure(tenantKey(p), name);
    // Default monthly AI cap of a new tenant: Supabase self-serve 300k (M3 migration), SQLite on-prem 2M.
    const CAP = () => (data.backend === "supabase" ? SUPABASE_FREE_TOKEN_CAP : TENANT_DEFAULTS.aiMonthlyTokenCap);
    beforeEach(() => { data = t.store(); });

    // ------------------------------------------------------------------ part 1: tenant isolation
    describe("tenant isolation", () => {
      let A: string, B: string;
      let bConv: string, bMsg: string, bSource: string;

      beforeEach(async () => {
        A = await data.tenants.ensure(tenantKey("ta"), "Tenant A");
        B = await data.tenants.ensure(tenantKey("tb"), "Tenant B");
        if (t.addMember) await t.addMember(B, `b-${randomUUID()}@example.test`, "B admin");

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

      it("A cannot read B: settings / brand / members", async () => {
        expect((await data.settings.get(A)).agentName).not.toBe("Bot B");
        expect(await data.settings.isToneSaved(A)).toBe(false);
        expect((await data.brand.get(A)).displayName).toBe("Tenant A");
        expect((await data.brand.get(A)).primaryColor).toBe("#0F766E");
        expect(await data.members.list(A)).toEqual([]);
        if (t.addMember) expect((await data.members.list(B)).map((m) => m.tenantId)).toEqual([B]);
      });

      it("A cannot read B: knowledge", async () => {
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

      it("A cannot read B: inbox", async () => {
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

      it("A cannot read B: add-ons, channels and secrets", async () => {
        expect((await data.addons.get(A, "shopify")).status).toBe("disconnected");
        expect((await data.channels.get(A, "whatsapp")).status).toBe("disconnected");
        expect(await data.secrets.get(A, "addon", "shopify")).toBeNull();
        expect(await data.secrets.get(A, "channel", "whatsapp")).toBeNull();
      });

      it("A cannot read B: audit, usage, limiter, retention lookups", async () => {
        expect(await data.audit.find(A, { action: "test.action" })).toBeNull();
        expect(await data.audit.list(A)).toEqual([]);
        expect((await data.usage.get(A)).inputTokens).toBe(0);
        expect(await data.usage.remaining(A)).toBe(CAP()); // B's 150 tokens never count against A's budget
        expect(await data.usage.remaining(B)).toBe(CAP() - 150);
        expect(await data.limiter.countLookupFailures(A, 0)).toBe(0);
        expect(await data.limiter.countLookupFailures(A, 0, { orderHash: "order-hash-b" })).toBe(0);
        expect(await data.retention.findCustomerConversations(A, "whatsapp", "5215500000000")).toEqual([]);
        expect(await data.retention.exportMessages(A, bConv)).toEqual([]);
      });

      it("A cannot change B: writes with B's ids / keys leave B untouched", async () => {
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
        await data.conversations.setTimestamps(A, bConv, { unread: 99, lastMessageAt: OLD });
        expect(await data.conversations.delete(A, bConv)).toEqual({ conversations: 0, messages: 0 });
        await data.messages.setCreatedAt(A, bMsg, OLD);
        await data.addons.save(A, "shopify", { status: "disconnected" });
        await data.secrets.clear(A, "addon", "shopify");
        await data.secrets.clear(A, "channel", "whatsapp");
        await data.channels.save(A, "whatsapp", { status: "disconnected", publicInfo: {} });
        expect(await data.audit.deleteByActor(A, "user-b")).toBe(0);
        expect(await data.retention.deleteConversations(A, [bConv])).toEqual({ conversations: 0, messages: 0 });
        expect(await data.retention.purgeTenant(A, PURGE_NOOP)).toMatchObject({ messagesDeleted: 0, conversationsDeleted: 0, messagesMasked: 0 });

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
        expect(conv!.lastMessageAt).not.toBe(OLD);
        const msgs = await data.messages.list(B, bConv);
        expect(msgs).toHaveLength(1);
        expect(msgs[0]).toMatchObject({ body: "hola soy B", providerMessageId: "wamid.B1" });
        expect(msgs[0].createdAt).not.toBe(OLD);
        expect((await data.addons.get(B, "shopify")).status).toBe("connected");
        expect(await data.secrets.get(B, "addon", "shopify")).toEqual({ shop: "b.myshopify.com", accessToken: "shpat_B" });
        expect(await data.secrets.get(B, "channel", "whatsapp")).toEqual({ accessToken: "EAAG-B" });
        expect((await data.channels.get(B, "whatsapp")).status).toBe("connected");
        expect(await data.audit.find(B, { action: "test.action" })).toBe("detail-b");
        expect((await data.usage.get(B)).inputTokens).toBe(100);
        expect(await data.limiter.countLookupFailures(B, 0)).toBe(1);
      });

      it("A's usage/limiter writes never count for B", async () => {
        await data.usage.record(A, { inputTokens: 7, outputTokens: 3 });
        await data.limiter.recordLookupFailure(A, "order-hash-b", "email-hash-b", Date.now(), 0);
        expect(await data.limiter.recordInbound(A, bConv, Date.now(), 0, 0)).toBe(1);
        expect(await data.limiter.recordInbound(B, bConv, Date.now(), 0, 0)).toBe(1);
        expect((await data.usage.get(B)).inputTokens).toBe(100);
        expect(await data.limiter.countLookupFailures(B, 0, { orderHash: "order-hash-b" })).toBe(1);
      });

      it("cross-tenant lookups are explicit and exact", async () => {
        expect(await data.channels.findTenantByExternalId("whatsapp", `phone-${B}`)).toBe(B);
        expect(await data.channels.findTenantByExternalId("whatsapp", `phone-${A}`)).toBeNull();
        // Webhook routing ids: B's id routes to B only; A has no row (null) and never sees B's id.
        const bHook = (await data.channels.get(B, "whatsapp")).webhookId;
        expect(bHook).toMatch(UUID_RE);
        expect(await data.channels.findByWebhookId("whatsapp", bHook!)).toEqual({ tenantId: B, channel: "whatsapp" });
        expect((await data.channels.get(A, "whatsapp")).webhookId).toBeNull();
        expect((await data.tenants.get(A))?.id).toBe(A);
        expect((await data.tenants.get(B))?.name).toBe("Tenant B");
        expect((await data.retention.tenantIds())).toEqual(expect.arrayContaining([A, B]));
      });
    });

    // ------------------------------------------------------------------ part 2: behaviour
    describe("secrets", () => {
      it("are never part of addon / channel reads and survive status changes until cleared", async () => {
        const T = await newTenant("sec");
        await data.secrets.set(T, "addon", "shopify", { shop: "s.myshopify.com", accessToken: "shpat_secret" });
        await data.addons.save(T, "shopify", { status: "connected", publicInfo: { shop: "s.myshopify.com" } });
        const addon = await data.addons.get(T, "shopify");
        expect(addon.status).toBe("connected");
        expect(addon.connectedAt).toBeTruthy();
        expect(JSON.stringify(addon)).not.toContain("shpat_secret");
        await data.addons.save(T, "shopify", { status: "connected", publicInfo: { shop: "s.myshopify.com", name: "S" } });
        expect(await data.secrets.get(T, "addon", "shopify")).toMatchObject({ accessToken: "shpat_secret" });
        await data.addons.save(T, "shopify", { status: "disconnected" });
        expect(await data.secrets.get(T, "addon", "shopify")).toBeNull();

        await data.channels.save(T, "telegram", { status: "connected", publicInfo: { externalId: `bot-${T}` } });
        await data.secrets.set(T, "channel", "telegram", { botToken: "123:ABC" });
        const ch = await data.channels.get(T, "telegram");
        expect(ch).toEqual({ channel: "telegram", status: "connected", publicInfo: { externalId: `bot-${T}` }, webhookId: expect.stringMatching(UUID_RE) });
        expect(JSON.stringify(ch)).not.toContain("123:ABC");
        await data.channels.save(T, "telegram", { status: "disconnected", publicInfo: {} });
        expect(await data.secrets.get(T, "channel", "telegram")).toEqual({ botToken: "123:ABC" }); // channels keep them...
        await data.secrets.clear(T, "channel", "telegram"); // ...until explicitly cleared
        expect(await data.secrets.get(T, "channel", "telegram")).toBeNull();
      });

      it("are stored encrypted (no plain token persisted)", async () => {
        const T = await newTenant("enc");
        await data.secrets.set(T, "channel", "whatsapp", { accessToken: "EAAG-plain-check" });
        const raw = await t.rawSecret(T, "channel", "whatsapp");
        expect(raw).toBeTruthy();
        expect(raw).not.toContain("EAAG-plain-check");
      });
    });

    describe("channels", () => {
      it("one external account belongs to one tenant: DataConflictError, and routing finds the owner", async () => {
        const a = await newTenant("cha"), b = await newTenant("chb"); const ext = `page-${randomUUID()}`;
        await data.channels.save(a, "messenger", { status: "connected", publicInfo: { externalId: ext } });
        await expect(data.channels.save(b, "messenger", { status: "connected", publicInfo: { externalId: ext } })).rejects.toBeInstanceOf(DataConflictError);
        expect(await data.channels.findTenantByExternalId("messenger", ext)).toBe(a);
        expect((await data.channels.get(b, "messenger")).status).toBe("disconnected");
        // Once A disconnects, B may connect the same account.
        await data.channels.save(a, "messenger", { status: "disconnected", publicInfo: { externalId: ext } });
        await data.channels.save(b, "messenger", { status: "connected", publicInfo: { externalId: ext } });
        expect(await data.channels.findTenantByExternalId("messenger", ext)).toBe(b);
      });
    });

    describe("channel webhook routing ids (Telegram)", () => {
      it("one stable public id per channel row; findByWebhookId routes connected accounts only", async () => {
        const a = await newTenant("wha"), b = await newTenant("whb");
        expect((await data.channels.get(a, "telegram")).webhookId).toBeNull(); // no row yet
        await data.channels.save(a, "telegram", { status: "connected", publicInfo: { externalId: `bot-${a}` } });
        const hookA = (await data.channels.get(a, "telegram")).webhookId!;
        expect(hookA).toMatch(UUID_RE);
        await data.channels.save(a, "telegram", { status: "connected", publicInfo: { externalId: `bot-${a}`, displayName: "Bot A" } });
        expect((await data.channels.get(a, "telegram")).webhookId).toBe(hookA); // saves never rotate it
        await data.channels.save(b, "telegram", { status: "connected", publicInfo: { externalId: `bot-${b}` } });
        const hookB = (await data.channels.get(b, "telegram")).webhookId!;
        expect(hookB).not.toBe(hookA);

        expect(await data.channels.findByWebhookId("telegram", hookA)).toEqual({ tenantId: a, channel: "telegram" });
        expect(await data.channels.findByWebhookId("telegram", hookA.toUpperCase())).toEqual({ tenantId: a, channel: "telegram" });
        expect(await data.channels.findByWebhookId("telegram", hookB)).toEqual({ tenantId: b, channel: "telegram" });
        expect(await data.channels.findByWebhookId("whatsapp", hookA)).toBeNull(); // other channel
        expect(await data.channels.findByWebhookId("telegram", randomUUID())).toBeNull();
        for (const bad of ["", "not-a-uuid", `${hookA}/../x`, "x' OR 1=1 --"]) expect(await data.channels.findByWebhookId("telegram", bad)).toBeNull();

        await data.channels.save(a, "telegram", { status: "disconnected", publicInfo: {} });
        expect(await data.channels.findByWebhookId("telegram", hookA)).toBeNull(); // fail closed once disconnected
        expect((await data.channels.get(a, "telegram")).webhookId).toBe(hookA);
        expect(await data.channels.findByWebhookId("telegram", hookB)).toEqual({ tenantId: b, channel: "telegram" });
      });
    });

    describe("tenants, platform admins and AI budget", () => {
      it("tenants.get returns the public tenant record with plan defaults", async () => {
        const T = await newTenant("tg", "Tienda G");
        const t1 = await data.tenants.get(T);
        expect(t1).toMatchObject({ id: T, name: "Tienda G", plan: "free", status: "active", aiMonthlyTokenCap: CAP() });
        expect(t1!.slug).toMatch(/^tg-/);
        expect(Number.isNaN(Date.parse(t1!.createdAt))).toBe(false);
        expect(await data.tenants.get(randomUUID())).toBeNull();
      });

      it("tenants.listAll: counts per tenant (this month only), search, paging, literal wildcards", async () => {
        const tag = `lst${randomUUID().slice(0, 8)}`;
        const a = await data.tenants.ensure(tenantKey(`${tag}a`), `List ${tag} A`);
        const b = await data.tenants.ensure(tenantKey(`${tag}b`), `List ${tag} B`);
        const c = await data.tenants.ensure(tenantKey(`${tag}c`), `Other ${tag} C`);
        if (t.addMember) await t.addMember(a, `m-${randomUUID()}@example.test`, "Miembro A");
        await data.conversations.getOrCreate(a, "telegram", "x1", "Uno");
        await data.conversations.getOrCreate(a, "whatsapp", "x2", "Dos");
        await data.conversations.getOrCreate(a, "simulator", "s1", "Sim"); // not counted
        const old = await data.conversations.getOrCreate(a, "telegram", "x3", "Viejo");
        await data.conversations.setTimestamps(a, old.id, { lastMessageAt: OLD }); // other month: not counted
        await data.conversations.getOrCreate(b, "telegram", "y1", "B");
        await data.channels.save(a, "telegram", { status: "connected", publicInfo: { externalId: `bot-${a}` } });
        await data.channels.save(a, "messenger", { status: "disconnected", publicInfo: {} });
        await data.usage.record(a, { inputTokens: 100, outputTokens: 20 });
        await data.usage.record(a, { inputTokens: 999 }, new Date("2000-01-15T00:00:00Z")); // other month
        await data.usage.record(b, { inputTokens: 4, outputTokens: 1 });

        const all = await data.tenants.listAll({ search: tag });
        expect(all.total).toBe(3);
        expect(all.period).toMatch(/^\d{4}-\d{2}-01$/);
        expect(all.items.map((x) => x.id).sort()).toEqual([a, b, c].sort());
        const ra = all.items.find((x) => x.id === a)!;
        expect(ra).toMatchObject({ name: `List ${tag} A`, plan: "free", status: "active", aiMonthlyTokenCap: CAP(), conversationsThisMonth: 2, connectedChannels: 1, aiTokensThisMonth: 120 });
        if (t.addMember) expect(ra.members).toBe(1);
        expect(all.items.find((x) => x.id === b)).toMatchObject({ conversationsThisMonth: 1, connectedChannels: 0, aiTokensThisMonth: 5, members: 0 });
        expect(all.items.find((x) => x.id === c)).toMatchObject({ conversationsThisMonth: 0, connectedChannels: 0, aiTokensThisMonth: 0, members: 0 });

        expect((await data.tenants.listAll({ search: `LIST ${tag}` })).total).toBe(2); // case-insensitive
        expect((await data.tenants.listAll({ search: `${tag}%` })).total).toBe(0); // % is literal
        expect((await data.tenants.listAll({ search: `${tag.slice(0, 3)}_${tag.slice(4)}` })).total).toBe(0); // _ is literal
        const p1 = await data.tenants.listAll({ search: tag, limit: 2 });
        const p2 = await data.tenants.listAll({ search: tag, limit: 2, offset: 2 });
        expect(p1.total).toBe(3);
        expect(p1.items).toHaveLength(2);
        expect(p2.items).toHaveLength(1);
        expect([...p1.items, ...p2.items].map((x) => x.id).sort()).toEqual([a, b, c].sort());
        // Another month: only that month's usage counts.
        const jan = await data.tenants.listAll({ search: tag, now: new Date("2000-01-20T00:00:00Z") });
        expect(jan.period).toBe("2000-01-01");
        expect(jan.items.find((x) => x.id === a)?.aiTokensThisMonth).toBe(999);
      });

      it("usage.remaining = cap - (input + output) this month, never negative, 0 for unknown tenants", async () => {
        const T = await newTenant("rem");
        expect(await data.usage.remaining(T)).toBe(CAP());
        await data.usage.record(T, { inputTokens: 1500, outputTokens: 500 });
        expect(await data.usage.remaining(T)).toBe(CAP() - 2000);
        await data.usage.record(T, { inputTokens: 3_000_000, outputTokens: 1 }, new Date("2000-01-02T00:00:00Z"));
        expect(await data.usage.remaining(T, new Date("2000-01-20T00:00:00Z"))).toBe(0);
        expect(await data.usage.remaining(T)).toBe(CAP() - 2000);
        expect(await data.usage.remaining(randomUUID())).toBe(0);
      });

      it("platformAdmins.isPlatformAdmin is true only for configured admins", async () => {
        const T = await newTenant("pa");
        expect(await data.platformAdmins.isPlatformAdmin(randomUUID())).toBe(false);
        expect(await data.platformAdmins.isPlatformAdmin("")).toBe(false);
        expect(await data.platformAdmins.isPlatformAdmin("not-a-uuid")).toBe(false);
        if (!t.makePlatformAdmin) return;
        const { admin, other } = await t.makePlatformAdmin(T);
        expect(await data.platformAdmins.isPlatformAdmin(admin)).toBe(true);
        expect(await data.platformAdmins.isPlatformAdmin(other)).toBe(false);
      });

      it("global audit rows (no tenant) are accepted and never show up in a tenant's log", async () => {
        const T = await newTenant("ag");
        await data.audit.log(AUDIT_GLOBAL_TENANT, "anonymous", "auth.login_failed", `hash-${T}`);
        expect(await data.audit.list(T)).toEqual([]);
      });
    });

    describe("conversations and messages", () => {
      it("providerMessageId is stored, mapped and used for inbound dedupe", async () => {
        const T = await newTenant("msg");
        const c = await data.conversations.getOrCreate(T, "telegram", "chat-1", "Ana");
        const m = await data.messages.add(T, c.id, { direction: "in", sender: "customer", body: "hola", meta: { media: "photo" }, providerMessageId: "tg-77" });
        expect(m).toMatchObject({ providerMessageId: "tg-77", meta: { media: "photo", providerMessageId: "tg-77" } });
        expect(await data.messages.hasProviderMessage(T, c.id, "tg-77")).toBe(true);
        expect(await data.messages.hasProviderMessage(T, c.id, "tg-78")).toBe(false);
        const out = await data.messages.add(T, c.id, { direction: "out", sender: "bot", body: "¡hola!", meta: { intent: "greeting" } });
        expect(out.providerMessageId).toBeNull();
        expect((await data.conversations.get(T, c.id))?.unread).toBe(1);
        expect(await data.messages.recent(T, c.id, 5)).toEqual([
          { sender: "customer", body: "hola", intent: null }, { sender: "bot", body: "¡hola!", intent: "greeting" },
        ]);
        expect((await data.messages.list(T, c.id)).map((x) => x.body)).toEqual(["hola", "¡hola!"]);
        expect((await data.messages.latest(T, [c.id])).get(c.id)).toEqual({ body: "¡hola!", sender: "bot" });
        expect(await data.messages.lastInboundAt(T, c.id)).toBe(m.createdAt);
        await data.conversations.markRead(T, c.id);
        expect((await data.conversations.get(T, c.id))?.unread).toBe(0);
      });

      it("getOrCreate, list filters, search, counts, prefix lookup (LIKE chars are literal), reset", async () => {
        const T = await newTenant("inbox");
        const a = await data.conversations.getOrCreate(T, "whatsapp", "x_1", "");
        expect((await data.conversations.getOrCreate(T, "whatsapp", "x_1", "Lupe")).id).toBe(a.id);
        expect((await data.conversations.get(T, a.id))?.customerName).toBe("Lupe");
        const b = await data.conversations.getOrCreate(T, "messenger", "xy1", "Mario");
        await data.conversations.getOrCreate(T, "simulator", "sim-1", "Sim");
        await data.conversations.setStatus(T, b.id, "needs_human", "human_request");
        await data.conversations.setStatus(T, b.id, "human"); // reason kept
        expect((await data.conversations.get(T, b.id))?.escalationReason).toBe("human_request");
        expect(await data.conversations.countByStatus(T)).toEqual({ bot: 1, needs_human: 0, human: 1, resolved: 0 });
        expect((await data.conversations.list(T, { channel: "messenger" })).map((c) => c.id)).toEqual([b.id]);
        expect((await data.conversations.list(T, { status: "human" })).map((c) => c.id)).toEqual([b.id]);
        expect((await data.conversations.list(T, { search: "lup" })).map((c) => c.id)).toEqual([a.id]);
        expect((await data.conversations.list(T, { search: "xy" })).map((c) => c.id)).toEqual([b.id]);
        expect(await data.conversations.list(T, { limit: 2 })).toHaveLength(2);
        expect(await data.conversations.listIdsByExternalPrefix(T, "x_")).toEqual([a.id]);
        expect(await data.conversations.findIdByExternal(T, "messenger", "xy1")).toBe(b.id);

        await data.conversations.setState(T, b.id, { offer: { reason: "x" }, misses: 2, botTurns: 4, capOffered: true, orderLock: "123" });
        await data.conversations.resetForBot(T, b.id);
        const r = await data.conversations.get(T, b.id);
        expect(r?.escalationReason).toBeNull();
        expect(r?.state).toEqual({ misses: 0, botTurns: 0, capOffered: false, orderLock: "123" });

        await data.messages.add(T, b.id, { direction: "in", sender: "customer", body: "uno" });
        expect(await data.conversations.delete(T, b.id)).toEqual({ conversations: 1, messages: 1 });
        expect(await data.conversations.get(T, b.id)).toBeNull();
      });

      // H1 (REVIEW-security-2): the legal hold is sticky. Resolve / return to bot / re-escalation / state writes never
      // clear it, the purge keeps the conversation (masked) and the customer lookup reports it as held.
      it("legal hold: set by a safety/legal escalation, kept by resolve, return-to-bot, re-escalation and setState", async () => {
        const T = await newTenant("hold"), O = await newTenant("hold-other");
        const c = await data.conversations.getOrCreate(T, "messenger", `psid-${randomUUID()}`, "Ana");
        const plain = await data.conversations.getOrCreate(T, "messenger", `psid-${randomUUID()}`, "Beto");
        const m = await data.messages.add(T, c.id, { direction: "in", sender: "customer", body: "sacó humo y me quemé" });
        expect((await data.conversations.get(T, c.id))?.legalHold).toBe(false);

        await data.conversations.setStatus(T, c.id, "needs_human", "safety");
        expect((await data.conversations.get(T, c.id))?.legalHold).toBe(true);
        // The inbox "Resolve" sequence (status route): setStatus(resolved) + resetForBot.
        await data.conversations.setStatus(T, c.id, "resolved");
        await data.conversations.resetForBot(T, c.id);
        let r = await data.conversations.get(T, c.id);
        expect(r?.escalationReason).toBeNull(); // display-only reason is cleared...
        expect(r?.legalHold).toBe(true); // ...the hold is not
        // "Return to bot", a later escalation with another reason and an engine state write keep it too.
        await data.conversations.setStatus(T, c.id, "bot");
        await data.conversations.resetForBot(T, c.id);
        await data.conversations.setStatus(T, c.id, "needs_human", "human_request");
        await data.conversations.setState(T, c.id, {});
        r = await data.conversations.get(T, c.id);
        expect(r?.escalationReason).toBe("human_request");
        expect(r?.legalHold).toBe(true);
        // "legal" holds as well; other reasons do not.
        await data.conversations.setStatus(T, plain.id, "needs_human", "no_answer");
        expect((await data.conversations.get(T, plain.id))?.legalHold).toBe(false);
        await data.conversations.setStatus(T, plain.id, "needs_human", "legal");
        await data.conversations.resetForBot(T, plain.id);
        expect((await data.conversations.get(T, plain.id))?.legalHold).toBe(true);

        // Purge: kept (body masked), even though it is idle and its reason is gone.
        await data.conversations.setTimestamps(T, c.id, { lastMessageAt: OLD, createdAt: OLD });
        await data.messages.setCreatedAt(T, m.id, OLD);
        const p = await data.retention.purgeTenant(T, {
          cutoff: new Date(Date.now() - 90 * 86_400_000).toISOString(), maskCutoff: new Date(Date.now() - 365 * 86_400_000).toISOString(), maskedBody: "[masked]",
        });
        expect(p.deletedConversationIds).not.toContain(c.id);
        expect((await data.messages.list(T, c.id)).map((x) => x.body)).toEqual(["[masked]"]);
        // Customer lookups (delete-customer / Meta deletion) see the hold through state.legalHold.
        const found = await data.retention.findCustomerConversations(T, "messenger", c.externalId);
        expect(JSON.parse(found[0].state).legalHold).toBe(true);

        // Cross-tenant: tenant O escalating with T's id holds nothing and changes nothing in T.
        const fresh = await data.conversations.getOrCreate(T, "telegram", `chat-${randomUUID()}`, "Caro");
        await data.conversations.setStatus(O, fresh.id, "needs_human", "safety");
        const f = await data.conversations.get(T, fresh.id);
        expect(f?.legalHold).toBe(false);
        expect(f?.status).toBe("bot");
        expect(await data.conversations.get(O, c.id)).toBeNull();
      });
    });

    // L1 (REVIEW-security-2): suspended / deleted tenants get no webhook routing and no AI budget.
    describe("tenant status", () => {
      it("isActive, webhook routing and the AI budget follow tenants.status; other tenants are unaffected", async () => {
        const S = await newTenant("susp"), K = await newTenant("keep");
        const extS = `page-${randomUUID()}`, extK = `page-${randomUUID()}`;
        await data.channels.save(S, "messenger", { status: "connected", publicInfo: { externalId: extS } });
        await data.channels.save(S, "telegram", { status: "connected", publicInfo: { externalId: `bot-${S}` } });
        await data.channels.save(K, "messenger", { status: "connected", publicInfo: { externalId: extK } });
        const hookS = (await data.channels.get(S, "telegram")).webhookId!;
        expect(await data.tenants.isActive(S)).toBe(true);
        expect(await data.channels.findTenantByExternalId("messenger", extS)).toBe(S);
        expect(await data.channels.findByWebhookId("telegram", hookS)).toEqual({ tenantId: S, channel: "telegram" });

        for (const status of ["suspended", "deleted"] as const) {
          await t.setTenantStatus(S, status);
          expect(await data.tenants.isActive(S)).toBe(false);
          expect((await data.tenants.get(S))?.status).toBe(status);
          expect(await data.channels.findTenantByExternalId("messenger", extS)).toBeNull();
          expect(await data.channels.findByWebhookId("telegram", hookS)).toBeNull();
          expect(await data.usage.remaining(S)).toBe(0);
          // The other tenant keeps working.
          expect(await data.tenants.isActive(K)).toBe(true);
          expect(await data.channels.findTenantByExternalId("messenger", extK)).toBe(K);
          expect(await data.usage.remaining(K)).toBe(CAP());
        }
        // The account stays owned while suspended (unique index): another tenant still cannot take it.
        await expect(data.channels.save(K, "telegram", { status: "connected", publicInfo: { externalId: `bot-${S}` } })).rejects.toBeInstanceOf(DataConflictError);

        await t.setTenantStatus(S, "active");
        expect(await data.tenants.isActive(S)).toBe(true);
        expect(await data.channels.findByWebhookId("telegram", hookS)).toEqual({ tenantId: S, channel: "telegram" });
        expect(await data.usage.remaining(S)).toBe(CAP());
        expect(await data.tenants.isActive(randomUUID())).toBe(data.backend === "sqlite"); // SQLite: no row = legacy active
      });
    });

    describe("knowledge", () => {
      it("sections, sources, links and chunks", async () => {
        const T = await newTenant("kn");
        expect((await data.sections.list(T))).toHaveLength(8);
        await data.sections.saveContent(T, "faq", "preguntas");
        await data.sections.setMode(T, "shipping_returns", "file"); // creates the row with empty text
        expect(await data.sections.getRow(T, "shipping_returns")).toMatchObject({ content: "", mode: "file", fileSourceId: null });
        expect(await data.sections.getRow(T, "faq")).toMatchObject({ content: "preguntas", mode: "text" });

        const s1 = await data.sources.create(T, { kind: "link", title: "Envíos", url: "https://t.example/envios" });
        expect(s1).toMatchObject({ kind: "link", status: "pending", url: "https://t.example/envios", filePath: null, error: null });
        expect(await data.sources.exists(T, s1.id)).toBe(true);
        await data.sources.updateStatus(T, s1.id, "indexed", undefined, "texto");
        await data.sources.updateStatus(T, s1.id, "error", "fetch_failed"); // keeps the text
        expect(await data.sources.getText(T, s1.id)).toMatchObject({ status: "error", error: "fetch_failed", text: "texto" });
        expect((await data.sources.list(T)).map((s) => s.id)).toEqual([s1.id]);

        expect(await data.sections.link(T, "shipping_returns", s1.id)).toBe(true);
        expect(await data.sections.link(T, "shipping_returns", s1.id)).toBe(true); // idempotent
        await data.sections.setFile(T, "faq", s1.id);
        expect((await data.sections.sectionsForSource(T, s1.id)).sort()).toEqual(["faq", "shipping_returns"]);
        await data.chunks.replace(T, { sourceId: s1.id }, [{ text: "general" }]);
        await data.chunks.replaceSection(T, "shipping_returns", [{ sourceId: s1.id, title: "Envíos", text: "linked" }, { sourceId: null, title: "", text: "own" }]);
        expect((await data.chunks.list(T)).map((c) => c.text).sort()).toEqual(["general", "linked", "own"]);
        await data.chunks.deleteGeneralForSource(T, s1.id);
        expect((await data.chunks.list(T)).map((c) => c.text).sort()).toEqual(["linked", "own"]);

        expect((await data.sections.removeSourceReferences(T, s1.id)).sort()).toEqual(["faq", "shipping_returns"]);
        expect(await data.sections.listLinks(T)).toEqual([]);
        expect(await data.sections.getRow(T, "faq")).toMatchObject({ mode: "text", fileSourceId: null, content: "preguntas" });
        await data.sources.delete(T, s1.id);
        expect(await data.sources.get(T, s1.id)).toBeNull();
        expect((await data.chunks.list(T)).map((c) => c.text)).toEqual(["own"]);
      });
    });

    describe("settings and brand", () => {
      it("settings default, clamp, tone marker", async () => {
        const T = await newTenant("set");
        const d = await data.settings.get(T);
        expect(d).toMatchObject({ tenantId: T, toneLevel: 3, crossSellLevel: 1, botEnabled: true, languageDefault: "es" });
        const s = await data.settings.save(T, { toneLevel: 9 as never, crossSellLevel: -2 as never, botEnabled: false, businessHours: "L-V 9-18" });
        expect(s).toMatchObject({ toneLevel: 5, crossSellLevel: 0, botEnabled: false, businessHours: "L-V 9-18" });
        expect(await data.settings.isToneSaved(T)).toBe(false);
        await data.settings.markToneSaved(T, "user-1");
        expect(await data.settings.isToneSaved(T)).toBe(true);
      });

      it("brand defaults like Supabase, saves a patch, validates like the CHECK constraints", async () => {
        const T = await newTenant("brand", "Mi Marca");
        expect(await data.brand.get(T)).toMatchObject({
          displayName: "Mi Marca", logoPath: null, primaryColor: "#0F766E", accentColor: "#14181F", menuBgColor: "#F6F7F9", headingFont: "system", updatedAt: null,
        });
        const saved = await data.brand.save(T, { primaryColor: "#aa00FF", headingFont: "Inter", logoPath: `${T}/logo.png` });
        expect(saved).toMatchObject({ displayName: "Mi Marca", primaryColor: "#aa00FF", headingFont: "Inter", logoPath: `${T}/logo.png` });
        expect(saved.updatedAt).toBeTruthy();
        await expect(data.brand.save(T, { primaryColor: "red" })).rejects.toBeInstanceOf(DataValidationError);
        await expect(data.brand.save(T, { headingFont: "Inter; } body { x" })).rejects.toBeInstanceOf(DataValidationError);
        await expect(data.brand.save(T, { displayName: "x".repeat(121) })).rejects.toBeInstanceOf(DataValidationError);
        expect((await data.brand.get(T)).primaryColor).toBe("#aa00FF");
      });
    });

    describe("usage, audit, limiter, rate limits", () => {
      it("AI usage accumulates per tenant and calendar month (UTC)", async () => {
        const T = await newTenant("use");
        await data.usage.record(T, { inputTokens: 120, outputTokens: 30 }, new Date("2026-11-03T10:00:00Z"));
        const r = await data.usage.record(T, { inputTokens: 80, outputTokens: 20 }, new Date("2026-11-30T23:59:00Z"));
        expect(r).toEqual({ tenantId: T, period: "2026-11-01", requests: 2, inputTokens: 200, outputTokens: 50 });
        await data.usage.record(T, { requests: 1, inputTokens: 5 }, new Date("2026-12-01T00:00:00Z"));
        expect(await data.usage.get(T, "2026-11-01")).toMatchObject({ requests: 2, inputTokens: 200 });
        expect(await data.usage.get(T, "2026-12-01")).toMatchObject({ requests: 1, inputTokens: 5, outputTokens: 0 });
        expect(await data.usage.record(T, { inputTokens: -50 }, new Date("2026-12-02T00:00:00Z"))).toMatchObject({ inputTokens: 5 });
      });

      it("audit log find / list / deleteByActor", async () => {
        const T = await newTenant("aud");
        await data.audit.log(T, "u1", "a.one", "d1");
        await data.audit.log(T, "u2", "a.two", "d2");
        await data.audit.log(T, "u1", "a.two", "d3");
        expect(await data.audit.find(T, { action: "a.two", actor: "u2" })).toBe("d2");
        expect((await data.audit.list(T, { actor: "u1" })).map((r) => r.detail)).toEqual(["d1", "d3"]);
        expect(await data.audit.deleteByActor(T, "u1")).toBe(2);
        expect((await data.audit.list(T)).map((r) => r.actor)).toEqual(["u2"]);
      });

      it("limiter counts by window (epoch ms) and prunes", async () => {
        const T = await newTenant("lim"); const now = Date.now();
        await data.limiter.recordLookupFailure(T, "o1", "e1", now - 5000, 0);
        await data.limiter.recordLookupFailure(T, "o2", "e1", now - 1000, 0);
        expect(await data.limiter.countLookupFailures(T, now - 10_000)).toBe(2);
        expect(await data.limiter.countLookupFailures(T, now - 3000)).toBe(1);
        expect(await data.limiter.countLookupFailures(T, 0, { emailHash: "e1" })).toBe(2);
        expect(await data.limiter.countLookupFailures(T, 0, { orderHash: "o1" })).toBe(1);
        await data.limiter.recordLookupFailure(T, "o3", "e3", now, now - 2000); // prunes the -5000 row
        expect(await data.limiter.countLookupFailures(T, 0)).toBe(2);
        const conv = randomUUID();
        expect(await data.limiter.recordInbound(T, conv, now - 4000, 0, now - 10_000)).toBe(1);
        expect(await data.limiter.recordInbound(T, conv, now, now - 3000, now - 10_000)).toBe(1); // pruned the first
      });

      it("rate limits: fixed window and login failure counters", async () => {
        const key = `rl-${randomUUID()}`; const t0 = 1_000_000;
        expect(await data.rateLimits.hit(key, 2, 60_000, t0)).toEqual({ ok: true, retryAfterS: 0 });
        expect(await data.rateLimits.hit(key, 2, 60_000, t0 + 1000)).toEqual({ ok: true, retryAfterS: 0 });
        expect(await data.rateLimits.hit(key, 2, 60_000, t0 + 2000)).toEqual({ ok: false, retryAfterS: 58 });
        expect(await data.rateLimits.hit(key, 2, 60_000, t0 + 60_000)).toEqual({ ok: true, retryAfterS: 0 });

        const lk = `login-${randomUUID()}`; const now = Date.now();
        await data.rateLimits.recordLoginFailure([lk, `${lk}-ip`], now);
        await data.rateLimits.recordLoginFailure([lk], now);
        expect(await data.rateLimits.countLoginFailures(lk, now - 1000)).toBe(2);
        expect(await data.rateLimits.countLoginFailures(`${lk}-ip`, now - 1000)).toBe(1);
        await data.rateLimits.clearLoginFailures(lk);
        expect(await data.rateLimits.countLoginFailures(lk, 0)).toBe(0);
        const old = `old-${randomUUID()}`;
        await data.rateLimits.recordLoginFailure([old], 1000);
        expect(await data.rateLimits.purge(2000)).toBeGreaterThanOrEqual(1);
        expect(await data.rateLimits.countLoginFailures(old, 0)).toBe(0);
      });
    });

    describe("retention", () => {
      it("purge deletes old data, keeps legal hold (masked), customer lookups/export/delete", async () => {
        const T = await newTenant("ret"); const psid = `psid-${randomUUID()}`;
        const old = await data.conversations.getOrCreate(T, "messenger", "psid-old", "Viejo");
        await data.messages.add(T, old.id, { direction: "in", sender: "customer", body: "viejo" });
        const heldC = await data.conversations.getOrCreate(T, "messenger", "psid-held", "Retenido");
        const hm = await data.messages.add(T, heldC.id, { direction: "in", sender: "customer", body: "amenaza" });
        await data.conversations.setStatus(T, heldC.id, "needs_human", "safety");
        const fresh = await data.conversations.getOrCreate(T, "messenger", psid, "Nuevo");
        await data.messages.add(T, fresh.id, { direction: "in", sender: "customer", body: "nuevo" });
        for (const c of [old, heldC]) await data.conversations.setTimestamps(T, c.id, { lastMessageAt: OLD, createdAt: OLD });
        for (const m of await data.messages.list(T, old.id)) await data.messages.setCreatedAt(T, m.id, OLD);
        await data.messages.setCreatedAt(T, hm.id, OLD);

        const cutoff = new Date(Date.now() - 90 * 86_400_000).toISOString();
        const maskCutoff = new Date(Date.now() - 365 * 86_400_000).toISOString();
        const p = await data.retention.purgeTenant(T, { cutoff, maskCutoff, maskedBody: "[masked]" });
        expect(p).toEqual({ messagesDeleted: 1, conversationsDeleted: 1, messagesMasked: 1, deletedConversationIds: [old.id] });
        expect(await data.conversations.get(T, old.id)).toBeNull();
        const kept = await data.messages.list(T, heldC.id);
        expect(kept.map((m) => m.body)).toEqual(["[masked]"]);
        expect(kept[0].meta.masked).toBeTruthy();

        const found = await data.retention.findCustomerConversations(T, "messenger", psid);
        expect(found.map((c) => c.id)).toEqual([fresh.id]);
        expect(JSON.parse(found[0].state)).toEqual({});
        expect((await data.retention.exportMessages(T, fresh.id)).map((m) => m.body)).toEqual(["nuevo"]);
        expect(await data.retention.findMetaDeletionTargets(psid)).toEqual([{ tenantId: T, channel: "messenger" }]);
        expect(await data.retention.deleteConversations(T, [fresh.id, heldC.id])).toEqual({ conversations: 2, messages: 2 });
        expect(await data.retention.findMetaDeletionTargets(psid)).toEqual([]);

        const code = `code-${randomUUID()}`;
        expect(await data.retention.metaDeletionReceived(code)).toBe(false);
        await data.audit.log(T, "meta", "privacy.meta_deletion_request", JSON.stringify({ confirmation_code: code }));
        expect(await data.retention.metaDeletionReceived(code)).toBe(true);
      });
    });
  });
}
