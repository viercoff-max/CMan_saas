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
        expect(await data.conversations.countByStatus(A)).toEqual({ bot: 0, needs_human: 0, human: 0, pending: 0, waiting_customer: 0, resolved: 0 });
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

    // ------------------------------------------------------------------ platform console (CROSS-TENANT by design)
    describe("platform console", () => {
      const soon = () => new Date(Date.now() + 60_000);
      const seed = async (p: string) => {
        const T = await newTenant(p, `Negocio ${p}`);
        const c1 = await data.conversations.getOrCreate(T, "telegram", "c1", "Uno");
        const c2 = await data.conversations.getOrCreate(T, "whatsapp", "c2", "Dos");
        await data.conversations.getOrCreate(T, "simulator", "s1", "Sim"); // never counted
        await data.conversations.setStatus(T, c1.id, "needs_human", "safety"); // urgent + legal hold
        await data.conversations.setStatus(T, c2.id, "needs_human", "no_answer"); // waiting, not urgent
        await data.channels.save(T, "telegram", { status: "connected", publicInfo: { externalId: `bot-${T}` } });
        await data.channels.save(T, "messenger", { status: "error", publicInfo: {} });
        await data.usage.record(T, { inputTokens: 300, outputTokens: 70 });
        return { T, c1: c1.id, c2: c2.id };
      };

      it("stats for one tenant: tenants, conversations per day, waiting / urgent, channels, AI, holds, activity", async () => {
        const { T } = await seed("pst");
        const s = await data.platform.stats({ tenantId: T, now: soon(), days: 30 });
        expect(s.tenants).toMatchObject({ total: 1, active: 1, suspended: 0, free: 1 });
        expect(s.byDay).toHaveLength(30);
        expect(s.byDay.every((d, i, xs) => /^\d{4}-\d{2}-\d{2}$/.test(d.day) && (i === 0 || xs[i - 1].day < d.day))).toBe(true);
        expect(s.byDay.reduce((n, d) => n + d.count, 0)).toBe(2);
        expect(s).toMatchObject({ waiting: 2, urgent: 1, urgentTenants: 1, aiInputTokens: 300, aiOutputTokens: 70, legalHolds: 1, legalHoldTenants: 1 });
        expect(Number.isNaN(Date.parse(String(s.oldestUrgentAt)))).toBe(false);
        expect(s.channels).toEqual(expect.arrayContaining([
          { channel: "telegram", status: "connected", count: 1 }, { channel: "messenger", status: "error", count: 1 },
        ]));
        expect(s.channelErrors).toEqual([{ tenantId: T, channel: "messenger" }]);
        expect(s.activity.map((a) => a.tenantId)).toEqual([T]);
        expect((await data.platform.stats({ tenantId: T, days: 7 })).byDay).toHaveLength(7);
      });

      it("global stats cover every tenant (cross-tenant by design)", async () => {
        const a = await seed("pga");
        const b = await seed("pgb");
        const g = await data.platform.stats({ now: soon() });
        expect(g.tenants.total).toBeGreaterThanOrEqual(2);
        expect(g.urgentTenants).toBeGreaterThanOrEqual(2);
        expect(g.activity.map((x) => x.tenantId)).toEqual(expect.arrayContaining([a.T, b.T]));
        expect(g.aiInputTokens).toBeGreaterThanOrEqual(600);
      });

      it("updateTenant: suspend / reactivate, plan and AI cap; validation; deleted or unknown tenants untouched", async () => {
        const T = await newTenant("pup");
        expect(await data.platform.updateTenant(T, { status: "suspended" })).toMatchObject({ id: T, status: "suspended" });
        expect(await data.tenants.isActive(T)).toBe(false);
        expect(await data.usage.remaining(T)).toBe(0); // suspended: no AI spend
        expect(await data.platform.updateTenant(T, { status: "active", plan: "pro", aiMonthlyTokenCap: 3_000_000 }))
          .toMatchObject({ status: "active", plan: "pro", aiMonthlyTokenCap: 3_000_000 });
        expect(await data.usage.remaining(T)).toBe(3_000_000);
        for (const bad of [{}, { status: "deleted" }, { plan: "gold" }, { aiMonthlyTokenCap: -1 }, { aiMonthlyTokenCap: 1.5 }, { aiMonthlyTokenCap: 2_000_000_000 }])
          await expect(data.platform.updateTenant(T, bad as never)).rejects.toBeInstanceOf(DataValidationError);
        const D = await newTenant("pdl");
        await t.setTenantStatus(D, "deleted");
        expect(await data.platform.updateTenant(D, { status: "active" })).toBeNull();
        expect((await data.tenants.get(D))?.status).toBe("deleted");
        expect(await data.platform.updateTenant(data.backend === "supabase" ? randomUUID() : `nope-${randomUUID()}`, { plan: "pro" })).toBeNull();
      });

      it("legal holds: listed per tenant (metadata only); lifting needs a reason, is audited and cannot cross tenants", async () => {
        const a = await seed("plh");
        const b = await seed("plx");
        const holds = await data.platform.legalHolds({ tenantId: a.T });
        expect(holds).toEqual([{ tenantId: a.T, conversationId: a.c1, channel: "telegram", reason: "safety", createdAt: expect.any(String) }]);
        expect((await data.platform.legalHolds()).map((h) => h.conversationId)).toEqual(expect.arrayContaining([a.c1, b.c1]));
        await expect(data.platform.liftLegalHold(a.T, a.c1, "admin-1", "because")).rejects.toBeInstanceOf(DataValidationError);
        expect(await data.platform.liftLegalHold(b.T, a.c1, "admin-1", "resolved")).toBe(false); // A's case through B: no
        expect(await data.platform.liftLegalHold(a.T, a.c2, "admin-1", "resolved")).toBe(false); // not on hold
        expect(await data.platform.liftLegalHold(a.T, a.c1, "admin-1", "resolved")).toBe(true);
        expect(await data.platform.legalHolds({ tenantId: a.T })).toEqual([]);
        expect(await data.platform.legalHolds({ tenantId: b.T })).toHaveLength(1); // B untouched
        expect((await data.conversations.get(a.T, a.c1))?.escalationReason ?? null).toBeNull();
        const log = await data.platform.audit({ prefixes: ["platform."], tenantId: a.T });
        expect(log).toEqual([expect.objectContaining({ tenantId: a.T, actor: "admin-1", action: "platform.legal_hold.lifted", detail: `${a.c1} resolved` })]);
        expect(await data.platform.liftLegalHold(a.T, a.c1, "admin-1", "resolved")).toBe(false); // already lifted
        // The purge may now delete it like any other conversation.
        await data.conversations.setTimestamps(a.T, a.c1, { lastMessageAt: OLD });
        await data.retention.purgeTenant(a.T, { cutoff: "2001-01-01T00:00:00.000Z", maskCutoff: OLD, maskedBody: "[masked]" });
        expect(await data.conversations.get(a.T, a.c1)).toBeNull();
      });

      it("audit by action prefix, newest first, with a tenant filter; demo ids; AI reserved today", async () => {
        const A = await newTenant("pau");
        const B = await newTenant("pav");
        await data.audit.log(A, "u1", "platform.tenant.plan", "pro");
        await data.audit.log(B, "u1", "platform.tenant.suspended", "payment");
        await data.audit.log(A, "u1", "privacy.customer_deleted", "1");
        await data.audit.log(A, "u1", "other.action", "x");
        const a = await data.platform.audit({ prefixes: ["platform.", "privacy."], tenantId: A, limit: 10 });
        expect(a.map((r) => r.action)).toEqual(["privacy.customer_deleted", "platform.tenant.plan"]);
        const all = await data.platform.audit({ prefixes: ["platform."], limit: 200 });
        expect(all.some((r) => r.tenantId === B && r.action === "platform.tenant.suspended")).toBe(true);
        expect(all.every((r) => r.action.startsWith("platform."))).toBe(true);
        for (const bad of [[], ["platform"], ["a.", "b.", "c.", "d.", "e.", "f."], ["x%."]])
          await expect(data.platform.audit({ prefixes: bad })).rejects.toBeInstanceOf(DataValidationError);

        await data.audit.log(B, "demo", "demo.business", "cafe");
        expect(await data.platform.demoTenantIds()).toContain(B);
        expect(await data.platform.demoTenantIds()).not.toContain(A);

        const day = new Date("2031-05-04T10:00:00Z");
        expect(await data.platform.aiReservedToday(day)).toBe(0);
        await data.rateLimits.hit("engine-ai-day:2031-05-04", 100, 172_800_000, day.getTime());
        await data.rateLimits.hit("engine-ai-day:2031-05-04", 100, 172_800_000, day.getTime());
        expect(await data.platform.aiReservedToday(day)).toBe(2_000);
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
        expect(await data.conversations.countByStatus(T)).toEqual({ bot: 1, needs_human: 0, human: 1, pending: 0, waiting_customer: 0, resolved: 0 });
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
    describe("team inbox: customers, notes, activity, assignment", () => {
      it("a real conversation gets a customer record; the simulator never does", async () => {
        const T = await newTenant("cust");
        const c = await data.conversations.getOrCreate(T, "telegram", "4242", "Ana López");
        expect(c.customerId).toBeTruthy();
        const cust = await data.customers.get(T, c.customerId!);
        expect(cust?.name).toBe("Ana López");
        expect((await data.conversations.getOrCreate(T, "telegram", "4242")).customerId).toBe(c.customerId);
        const sim = await data.conversations.getOrCreate(T, "simulator", "sim-1", "Prueba");
        expect(sim.customerId ?? null).toBeNull();
        const list = await data.customers.list(T);
        expect(list).toHaveLength(1);
        expect(list[0]).toMatchObject({ id: c.customerId, conversations: 1, channels: ["telegram"] });
        expect((await data.conversations.list(T, { customerId: c.customerId! })).map((x) => x.id)).toEqual([c.id]);
      });

      it("customer update validates like the database; merge moves conversations and deletes the merged record", async () => {
        const T = await newTenant("merge");
        const a = await data.conversations.getOrCreate(T, "telegram", "1", "Ana");
        const b = await data.conversations.getOrCreate(T, "whatsapp", "5215500000000", "");
        const up = await data.customers.update(T, a.customerId!, { email: " ANA@Example.test ", phone: "+52 55 1234 5678", tags: ["vip", " vip ", "garantía"], notes: "Prefiere WhatsApp" });
        expect(up).toMatchObject({ email: "ana@example.test", phone: "+52 55 1234 5678", tags: ["vip", "garantía"], notes: "Prefiere WhatsApp" });
        await expect(data.customers.update(T, a.customerId!, { email: "no-es-correo" })).rejects.toBeInstanceOf(DataValidationError);
        await expect(data.customers.update(T, a.customerId!, { tags: Array.from({ length: 21 }, (_, i) => `t${i}`) })).rejects.toBeInstanceOf(DataValidationError);
        await data.customers.update(T, b.customerId!, { tags: ["mayoreo"] });
        expect(await data.customers.merge(T, b.customerId!, a.customerId!)).toBe(true);
        expect(await data.customers.get(T, b.customerId!)).toBeNull();
        expect((await data.conversations.get(T, b.id))?.customerId).toBe(a.customerId);
        expect((await data.customers.get(T, a.customerId!))?.tags.sort()).toEqual(["garantía", "mayoreo", "vip"]);
        expect(await data.customers.merge(T, a.customerId!, a.customerId!)).toBe(false);
      });

      it("orphan customers are deleted once their last conversation is gone", async () => {
        const T = await newTenant("orphan");
        const c = await data.conversations.getOrCreate(T, "telegram", "77", "Beto");
        const keep = await data.conversations.getOrCreate(T, "telegram", "78", "Caro");
        await data.conversations.delete(T, c.id);
        expect(await data.customers.deleteOrphans(T)).toBe(0); // too recent: may be linked right now
        expect(await data.customers.deleteOrphans(T, -3_600_000)).toBe(1); // cutoff in the future (the Supabase fake clock runs ahead)
        expect(await data.customers.get(T, c.customerId!)).toBeNull();
        expect(await data.customers.get(T, keep.customerId!)).not.toBeNull();
      });

      it("notes and events: listed in order, only the author deletes a note, gone with the conversation", async () => {
        const T = await newTenant("notes");
        const c = await data.conversations.getOrCreate(T, "telegram", "90", "Dani");
        const u1 = randomUUID(), u2 = randomUUID();
        const n1 = await data.notes.add(T, c.id, { authorUserId: u1, body: "Cliente molesto, llamar mañana" });
        await data.notes.add(T, c.id, { authorUserId: u2, body: "Ya le marqué" });
        expect((await data.notes.list(T, c.id)).map((n) => n.body)).toEqual(["Cliente molesto, llamar mañana", "Ya le marqué"]);
        expect(await data.notes.remove(T, c.id, n1!.id, u2)).toBe(false); // not the author
        const other = await data.conversations.getOrCreate(T, "telegram", "90b");
        expect(await data.notes.remove(T, other.id, n1!.id, u1)).toBe(false); // not through another conversation
        expect(await data.notes.remove(T, c.id, n1!.id, u1)).toBe(true);
        await data.events.add(T, c.id, { actorUserId: null, kind: "handoff", detail: { reason: "safety" } });
        await data.events.add(T, c.id, { actorUserId: u1, kind: "status", detail: { from: "needs_human", to: "human" } });
        const ev = await data.events.list(T, c.id);
        expect(ev.map((e) => e.kind)).toEqual(["handoff", "status"]);
        expect(ev[0].detail).toEqual({ reason: "safety" });
        await data.conversations.delete(T, c.id);
        expect(await data.notes.list(T, c.id)).toEqual([]);
        expect(await data.events.list(T, c.id)).toEqual([]);
      });

      it("countLegalHolds: real held conversations only (simulator and demo- transcripts excluded), uncapped", async () => {
        const T = await newTenant("holds"), U = await newTenant("holds2");
        const demo = await data.conversations.getOrCreate(T, "telegram", "demo-seguridad");
        await data.conversations.setStatus(T, demo.id, "needs_human", "safety");
        const sim = await data.conversations.getOrCreate(T, "simulator", "sim-x");
        await data.conversations.setStatus(T, sim.id, "needs_human", "legal");
        expect(await data.conversations.countLegalHolds(T, "demo-")).toBe(0);
        const real = await data.conversations.getOrCreate(T, "telegram", "777");
        await data.conversations.setStatus(T, real.id, "needs_human", "safety");
        await data.conversations.setStatus(T, real.id, "resolved");
        expect(await data.conversations.countLegalHolds(T, "demo-")).toBe(1);
        expect(await data.conversations.countLegalHolds(U, "demo-")).toBe(0); // cross-tenant
      });

      it("new statuses: pending and waiting_customer are stored, filtered and counted", async () => {
        const T = await newTenant("status2");
        const c = await data.conversations.getOrCreate(T, "telegram", "91");
        await data.conversations.setStatus(T, c.id, "pending");
        expect((await data.conversations.list(T, { status: "pending" })).map((x) => x.id)).toEqual([c.id]);
        await data.conversations.setStatus(T, c.id, "waiting_customer");
        expect((await data.conversations.countByStatus(T)).waiting_customer).toBe(1);
      });

      it("assignment: assign / unassign, filter by assignee and unassigned", async () => {
        const T = await newTenant("assign");
        const user = t.addMember ? await t.addMember(T, `agent-${randomUUID()}@example.test`, "Agente") : randomUUID();
        const c = await data.conversations.getOrCreate(T, "telegram", "92");
        const d = await data.conversations.getOrCreate(T, "telegram", "93");
        expect(await data.conversations.assign(T, c.id, user)).toBe(true);
        expect((await data.conversations.get(T, c.id))?.assignedTo).toBe(user);
        expect((await data.conversations.list(T, { assignedTo: user })).map((x) => x.id)).toEqual([c.id]);
        expect((await data.conversations.list(T, { assignedTo: "none" })).map((x) => x.id)).toEqual([d.id]);
        expect(await data.conversations.assign(T, c.id, null)).toBe(true);
        expect((await data.conversations.get(T, c.id))?.assignedTo ?? null).toBeNull();
      });

      it("cross-tenant negative: A cannot read, change, merge, link or annotate B's customers and conversations", async () => {
        const A = await newTenant("ta"), B = await newTenant("tb");
        const b = await data.conversations.getOrCreate(B, "telegram", "500", "Cliente de B");
        const a = await data.conversations.getOrCreate(A, "telegram", "501", "Cliente de A");
        await data.notes.add(B, b.id, { authorUserId: null, body: "nota de B" });
        await data.events.add(B, b.id, { actorUserId: null, kind: "handoff" });
        expect(await data.customers.get(A, b.customerId!)).toBeNull();
        expect((await data.customers.list(A)).map((c) => c.id)).toEqual([a.customerId]);
        expect(await data.customers.update(A, b.customerId!, { name: "hack" })).toBeNull();
        expect(await data.customers.merge(A, b.customerId!, a.customerId!)).toBe(false);
        expect(await data.customers.merge(A, a.customerId!, b.customerId!)).toBe(false);
        expect(await data.conversations.setCustomer(A, a.id, b.customerId!)).toBe(false);
        expect(await data.conversations.setCustomer(A, b.id, a.customerId!)).toBe(false);
        expect(await data.conversations.assign(A, b.id, randomUUID())).toBe(false);
        expect(await data.notes.add(A, b.id, { authorUserId: null, body: "x" })).toBeNull();
        expect(await data.notes.list(A, b.id)).toEqual([]);
        await data.events.add(A, b.id, { actorUserId: null, kind: "note" });
        expect(await data.events.list(A, b.id)).toEqual([]);
        expect(await data.conversations.list(A, { customerId: b.customerId! })).toEqual([]);
        expect(await data.customers.deleteOrphans(A)).toBe(0);
        // B untouched
        expect((await data.customers.get(B, b.customerId!))?.name).toBe("Cliente de B");
        expect(await data.notes.list(B, b.id)).toHaveLength(1);
        expect(await data.events.list(B, b.id)).toHaveLength(1);
        expect((await data.conversations.get(B, b.id))?.assignedTo ?? null).toBeNull();
      });
    });

    describe("dashboard: period reads and preferences", () => {
      it("messages.listSince / events.listSince return only this tenant's rows since the date", async () => {
        const A = await newTenant("dsa"), B = await newTenant("dsb");
        const a = await data.conversations.getOrCreate(A, "telegram", "1");
        const b = await data.conversations.getOrCreate(B, "telegram", "1");
        const old = await data.messages.add(A, a.id, { direction: "in", sender: "customer", body: "viejo" });
        await data.messages.setCreatedAt(A, old.id, OLD);
        await data.messages.add(A, a.id, { direction: "in", sender: "customer", body: "nuevo" });
        await data.messages.add(B, b.id, { direction: "in", sender: "customer", body: "de B" });
        await data.events.add(A, a.id, { actorUserId: null, kind: "handoff" });
        await data.events.add(B, b.id, { actorUserId: null, kind: "handoff" });
        const since = "2020-01-01T00:00:00.000Z";
        expect((await data.messages.listSince(A, since)).map((m) => m.body)).toEqual(["nuevo"]);
        expect((await data.events.listSince(A, since)).map((e) => e.conversationId)).toEqual([a.id]);
      });

      it("prefs are per person and per business (cross-tenant negative)", async () => {
        const A = await newTenant("dpa"), B = await newTenant("dpb");
        const u = randomUUID(), v = randomUUID();
        expect(await data.dashboardPrefs.get(A, u)).toBeNull();
        await data.dashboardPrefs.save(A, u, ["waiting", "per_day"]);
        await data.dashboardPrefs.save(A, u, ["ai"]);
        await data.dashboardPrefs.save(B, u, ["agents"]);
        expect(await data.dashboardPrefs.get(A, u)).toEqual(["ai"]);
        expect(await data.dashboardPrefs.get(B, u)).toEqual(["agents"]);
        expect(await data.dashboardPrefs.get(A, v)).toBeNull();
      });
    });

    describe("notices: devices, preferences and notices", () => {
      it("per person and per business; cross-tenant negative; a device moves to whoever subscribes it last", async () => {
        const A = await newTenant("pa"), B = await newTenant("pb");
        const u = randomUUID(), v = randomUUID();
        const e1 = `https://fcm.googleapis.com/fcm/send/${randomUUID()}`;
        expect(await data.push.getPrefs(A, u)).toEqual({ waiting: true, urgent: true, assigned: true });
        await data.push.savePrefs(A, u, { waiting: false, urgent: true, assigned: false });
        expect(await data.push.getPrefs(A, u)).toEqual({ waiting: false, urgent: true, assigned: false });
        expect(await data.push.getPrefs(B, u)).toEqual({ waiting: true, urgent: true, assigned: true });
        await data.push.subscribe(A, u, e1, "Chrome");
        expect((await data.push.devicesFor(A, [u, v])).map((d) => d.endpoint)).toEqual([e1]);
        expect(await data.push.devicesFor(B, [u])).toEqual([]);
        expect(await data.push.unsubscribe(B, u, e1)).toBe(false); // other tenant
        await data.push.subscribe(B, v, e1, "Chrome"); // same device, now another person / business
        expect(await data.push.listDevices(A, u)).toEqual([]);
        expect((await data.push.listDevices(B, v)).map((d) => d.endpoint)).toEqual([e1]);
        await data.push.removeEndpoint(e1);
        expect(await data.push.listDevices(B, v)).toEqual([]);
        await data.push.addNotice(A, u, { kind: "waiting", title: "t1", body: "", url: "/inbox" });
        await data.push.addNotice(B, v, { kind: "urgent", title: "t2", body: "", url: "/inbox" });
        expect((await data.push.latestNotices(u, "2000-01-01T00:00:00.000Z")).map((n) => n.title)).toEqual(["t1"]);
        expect(await data.push.purgeNotices(B, "2999-01-01T00:00:00.000Z")).toBe(1);
        expect((await data.push.latestNotices(u, "2000-01-01T00:00:00.000Z")).map((n) => n.title)).toEqual(["t1"]); // A untouched
      });
    });

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
