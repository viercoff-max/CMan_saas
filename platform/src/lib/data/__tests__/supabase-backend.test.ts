// Supabase DataStore, offline: the shared contract (data-store-contract.ts) on an in-memory fake of the supabase-js
// query builder, plus mapper / error-mapping unit tests and the tenant-scoping proof: EVERY query the backend issued
// on a tenant-owned table carried a tenant_id filter (or stamped tenant_id on the rows it wrote), except the
// documented cross-tenant lookups.
import "../../channels/__tests__/env-secrets";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { DataBackendError, DataBackendUnsupportedError, DataConflictError, DataValidationError } from "../errors";
import { createSupabaseStore } from "../supabase";
import { scoped } from "../supabase/client";
import {
  businessHoursFromDb, businessHoursToDb, escapeLike, externalIdOf, iso, mapCustomerConversation, mapDbError, mapMessage,
  mapSource, msToIso, obj,
} from "../supabase/map";
import { defineDataStoreContract, tenantKey } from "./data-store-contract";
import { FakeSupabase, TENANT_TABLES, type Recorded } from "./supabase-fake";

const fake = new FakeSupabase();
const store = createSupabaseStore(fake);

defineDataStoreContract({
  name: "supabase (fake)",
  store: () => store,
  async rawSecret(tenantId, kind, key) {
    const r = fake.tables.tenant_secrets.find((x) => x.tenant_id === tenantId && x.kind === kind && x.key === key);
    return (r?.config_enc as string) ?? null;
  },
  async addMember(tenantId, email, name) { return fake.addMember(tenantId, { email, name }); },
  async makePlatformAdmin(tenantId) {
    const admin = fake.addMember(tenantId, { email: `pa-${randomUUID()}@example.test`, name: "PA" });
    const other = fake.addMember(tenantId, { email: `po-${randomUUID()}@example.test`, name: "PO" });
    fake.tables.platform_admins.push({ user_id: admin, created_at: new Date().toISOString() });
    return { admin, other };
  },
  async setTenantStatus(tenantId, status) {
    const row = fake.tables.tenants.find((x) => x.id === tenantId);
    if (row) row.status = status;
  },
});

// ------------------------------------------------------------------ mappers and error mapping
describe("supabase mappers", () => {
  it("timestamps, epoch ms, jsonb, LIKE escaping", () => {
    expect(iso("2026-11-19T22:44:48.123456+00:00")).toBe("2026-11-19T22:44:48.123Z");
    expect(iso("2026-11-19T16:44:48-06:00")).toBe("2026-11-19T22:44:48.000Z");
    expect(iso(null)).toBeNull();
    expect(msToIso(0)).toBe("1970-01-01T00:00:00.000Z");
    expect(obj(null)).toEqual({});
    expect(obj('{"a":1}')).toEqual({ a: 1 });
    expect(obj([1])).toEqual({});
    expect(escapeLike("50%_off\\")).toBe("50\\%\\_off\\\\");
  });
  it("business_hours jsonb <-> string", () => {
    expect(businessHoursFromDb({})).toBe("{}");
    expect(businessHoursFromDb(null)).toBe("{}");
    expect(businessHoursFromDb("L-V 9-18")).toBe("L-V 9-18");
    expect(businessHoursToDb('{"mon":"9-18"}')).toEqual({ mon: "9-18" });
    expect(businessHoursToDb("L-V 9-18")).toBe("L-V 9-18");
    expect(businessHoursFromDb(businessHoursToDb('{"mon":"9-18"}'))).toBe('{"mon":"9-18"}');
  });
  it("messages: provider_message_id column wins; meta fallback", () => {
    const base = { id: "m", conversation_id: "c", tenant_id: "t", direction: "in", sender: "customer", body: "x", created_at: "2026-01-01T00:00:00+00:00" };
    expect(mapMessage({ ...base, provider_message_id: "col", meta: { providerMessageId: "meta" } }).providerMessageId).toBe("col");
    expect(mapMessage({ ...base, provider_message_id: null, meta: { providerMessageId: "meta" } }).providerMessageId).toBe("meta");
    expect(mapMessage({ ...base, provider_message_id: null, meta: {} })).toMatchObject({ providerMessageId: null, createdAt: "2026-01-01T00:00:00.000Z" });
  });
  it("sources: storage_path is the domain filePath", () => {
    expect(mapSource({ id: "s", tenant_id: "t", kind: "file", title: "x", url: null, storage_path: "t/a.pdf", status: "pending", created_at: "2026-01-01T00:00:00Z" }).filePath).toBe("t/a.pdf");
  });
  it("legal_hold column surfaces as state.legalHold for lib/retention", () => {
    const r = { id: "c", channel: "messenger", external_id: "p", customer_name: "", status: "bot", escalation_reason: null, state: { a: 1 }, created_at: null, last_message_at: null };
    expect(JSON.parse(mapCustomerConversation({ ...r, legal_hold: true }).state)).toEqual({ a: 1, legalHold: true });
    expect(JSON.parse(mapCustomerConversation({ ...r, legal_hold: false }).state)).toEqual({ a: 1 });
  });
  it("channel external_id comes from publicInfo.externalId", () => {
    expect(externalIdOf({ externalId: " 123 " })).toBe("123");
    expect(externalIdOf({ externalId: 42 })).toBe("42");
    expect(externalIdOf({ externalId: "" })).toBeNull();
    expect(externalIdOf({})).toBeNull();
    expect(externalIdOf(undefined)).toBeNull();
  });
  it("Postgres errors -> backend-neutral errors, without leaking details", () => {
    const pii = "Key (channel, external_id)=(whatsapp, 5215512345678) already exists.";
    const ch = mapDbError({ code: "23505", message: 'duplicate key value violates unique constraint "uq_channel_external"', details: pii }, "channels.save");
    expect(ch).toBeInstanceOf(DataConflictError);
    expect(ch.message).toBe("channel_in_use");
    expect(mapDbError({ code: "23505", message: 'duplicate key value violates unique constraint "tenants_slug_key"' }, "x").message).toBe("tenants_slug_key");
    const chk = mapDbError({ code: "23514", message: 'new row violates check constraint "agent_settings_agent_name_check"', details: "Failing row contains (secret)" }, "settings.save");
    expect(chk).toBeInstanceOf(DataValidationError);
    expect((chk as DataValidationError).field).toBe("agent_settings_agent_name_check");
    expect(mapDbError({ code: "22P02", message: 'invalid input syntax for type uuid: "abc"' }, "x")).toBeInstanceOf(DataValidationError);
    expect((mapDbError({ code: "23503", message: "fk" }, "x") as DataValidationError).field).toBe("reference");
    const other = mapDbError({ code: "57014", message: "canceling statement due to statement timeout", details: pii, hint: "h" }, "conversations.list");
    expect(other).toBeInstanceOf(DataBackendError);
    expect(other.message).toBe("Supabase conversations.list failed (code 57014).");
    for (const e of [ch, chk, other]) expect(e.message).not.toMatch(/5215512345678|secret|Failing row/);
  });
});

// ------------------------------------------------------------------ backend specifics
describe("supabase backend specifics", () => {
  const T = async () => store.tenants.ensure(tenantKey("sp"), "SP");

  it("tenants.ensure works by slug (idempotent, normalised) and returns the uuid", async () => {
    const slug = tenantKey("Slug");
    const id = await store.tenants.ensure(slug, "Mi Tienda");
    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await store.tenants.ensure(slug.toLowerCase(), "otro")).toBe(id);
    expect(await store.tenants.ensure(id, "x")).toBe(id);
    expect(await store.tenants.get(id)).toEqual({
      id, name: "Mi Tienda", slug: slug.toLowerCase(), plan: "free", status: "active", aiMonthlyTokenCap: 300000, createdAt: expect.any(String),
    });
    await expect(store.tenants.ensure("Bad Slug!", "x")).rejects.toBeInstanceOf(DataValidationError);
    await expect(store.tenants.ensure(randomUUID(), "x")).rejects.toBeInstanceOf(DataValidationError);
    expect(await store.tenants.get("chefman")).toBeNull();
  });

  it("non-uuid tenant ids fail loudly; non-uuid entity ids are simply not found", async () => {
    await expect(store.settings.get("chefman")).rejects.toBeInstanceOf(DataValidationError);
    await expect(store.conversations.list("t-legacy")).rejects.toBeInstanceOf(DataValidationError);
    const t = await T();
    expect(await store.conversations.get(t, "not-a-uuid")).toBeNull();
    expect(await store.sources.get(t, "nope")).toBeNull();
    expect(await store.conversations.delete(t, "nope")).toEqual({ conversations: 0, messages: 0 });
    expect(await store.retention.deleteConversations(t, ["nope"])).toEqual({ conversations: 0, messages: 0 });
    await expect(store.sections.setFile(t, "faq", "nope")).rejects.toBeInstanceOf(DataValidationError);
  });

  it("duplicate inbound (uq_msg_provider 23505) returns the stored message and does not bump unread", async () => {
    const t = await T();
    const c = await store.conversations.getOrCreate(t, "whatsapp", "521", "Ana");
    const a = await store.messages.add(t, c.id, { direction: "in", sender: "customer", body: "hola", providerMessageId: "wamid.1" });
    const b = await store.messages.add(t, c.id, { direction: "in", sender: "customer", body: "hola", providerMessageId: "wamid.1" });
    expect(b.id).toBe(a.id);
    expect(await store.messages.list(t, c.id)).toHaveLength(1);
    expect((await store.conversations.get(t, c.id))?.unread).toBe(1);
  });

  it("a cross-tenant composite FK reference is rejected as invalid", async () => {
    const a = await T(), b = await T();
    const src = await store.sources.create(b, { kind: "link", title: "B", url: "https://b.example" });
    await expect(store.sections.setFile(a, "faq", src.id)).rejects.toBeInstanceOf(DataValidationError);
    await expect(store.chunks.replace(a, { sourceId: src.id }, [{ text: "x" }])).rejects.toBeInstanceOf(DataValidationError);
  });

  it("search treats LIKE wildcards literally", async () => {
    const t = await T();
    const off = await store.conversations.getOrCreate(t, "messenger", "p1", "50% off");
    await store.conversations.getOrCreate(t, "messenger", "p2", "abc");
    expect((await store.conversations.list(t, { search: "%" })).map((c) => c.id)).toEqual([off.id]);
  });

  it("reads past the PostgREST row cap in pages", async () => {
    const t = await T();
    await store.chunks.replaceSection(t, "faq", Array.from({ length: 1205 }, (_, i) => ({ sourceId: null, title: "", text: `c${i}` })));
    expect(await store.chunks.list(t)).toHaveLength(1205);
  });

  it("file sources store the tenant's object path; a path outside the tenant folder is refused", async () => {
    const t = await T(), other = await T();
    const src = await store.sources.create(t, { kind: "file", title: "a.pdf", filePath: `${t}/0f-a.pdf` });
    expect(src).toMatchObject({ kind: "file", filePath: `${t}/0f-a.pdf`, url: null, status: "pending" });
    expect(fake.tables.sources.find((r) => r.id === src.id)?.storage_path).toBe(`${t}/0f-a.pdf`);
    for (const bad of [`${other}/a.pdf`, "a.pdf", `${t}/../${other}/a.pdf`, `${t}//a.pdf`, `${t}/`, undefined])
      await expect(store.sources.create(t, { kind: "file", title: "a.pdf", filePath: bad })).rejects.toBeInstanceOf(DataValidationError);
  });

  it("local password login: unsupported with a clear error", async () => {
    const t = await T();
    await expect(store.users.findLoginByEmail("a@b.test")).rejects.toThrow(/Supabase Auth/);
    await expect(store.users.create({ tenantId: t, email: "a@b.test", name: "A", passwordHash: "x" })).rejects.toBeInstanceOf(DataBackendUnsupportedError);
    await expect(store.users.setPasswordHash(randomUUID(), "x")).rejects.toBeInstanceOf(DataBackendUnsupportedError);
  });

  it("members and users come from tenant_members + Supabase Auth", async () => {
    const t = await T();
    const uid = fake.addMember(t, { email: "lu@example.test", name: "Lu", role: "agent" });
    expect(await store.members.list(t)).toEqual([{ userId: uid, tenantId: t, name: "Lu", email: "lu@example.test", role: "agent" }]);
    expect(await store.users.get(uid)).toEqual({ id: uid, tenantId: t, name: "Lu", email: "lu@example.test" });
    expect(await store.users.get(randomUUID())).toBeNull();
    expect(await store.users.count()).toBeGreaterThan(0);
  });

  it("database failures surface as DataBackendError without values", async () => {
    const t = await T();
    fake.failNext("conversations", { code: "57014", message: "canceling statement", details: "5215512345678" });
    const e = await store.conversations.list(t).catch((x: unknown) => x as Error);
    expect(e).toBeInstanceOf(DataBackendError);
    expect((e as Error).message).not.toContain("5215512345678");
    fake.failNext("retention_purge_tenant", { code: "42883", message: "function does not exist" });
    await expect(store.retention.purgeTenant(t, { cutoff: "2000-01-01T00:00:00Z", maskCutoff: "2000-01-01T00:00:00Z", maskedBody: "x" })).rejects.toThrow(/code 42883/);
  });

  it("the scoped wrapper forces the tenant: tenant_id in a payload is overwritten / stripped", async () => {
    const a = await T(), b = await T();
    const s = scoped(fake, a);
    await s.from("audit_log").insert({ tenant_id: b, actor: "x", action: "forged", detail: "" });
    expect(fake.tables.audit_log.find((r) => r.action === "forged")?.tenant_id).toBe(a);
    await s.from("audit_log").update({ tenant_id: b, detail: "moved" });
    expect(fake.tables.audit_log.filter((r) => r.tenant_id === b && r.action === "forged")).toEqual([]);
    expect(() => scoped(fake, "chefman")).toThrow(DataValidationError);
  });
});

// ------------------------------------------------------------------ the tenant-scoping proof (runs last)
describe("tenant scoping of every query the Supabase backend issued", () => {
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const has = (q: Recorded, col: string, op = "eq") => q.filters.some((f) => f.col === col && f.op === op);
  // The documented CROSS-TENANT lookups (types.ts): webhook routing, Meta deletion callback, retention job, users.
  const CROSS_TENANT: { name: string; match: (q: Recorded) => boolean }[] = [
    { name: "channels.findTenantByExternalId", match: (q) => q.table === "channel_accounts" && q.kind === "select" && has(q, "channel") && has(q, "external_id") && has(q, "status") && !has(q, "tenant_id") },
    { name: "retention.findMetaDeletionTargets", match: (q) => q.table === "conversations" && q.kind === "select" && has(q, "external_id") && has(q, "channel", "in") },
    { name: "retention.metaDeletionReceived", match: (q) => q.table === "audit_log" && q.kind === "select" && q.filters.some((f) => f.col === "action" && f.val === "privacy.meta_deletion_request") && has(q, "detail", "like") },
    { name: "users.count", match: (q) => q.table === "tenant_members" && q.kind === "select" && q.filters.length === 0 && q.columns === "user_id" },
    { name: "users.get", match: (q) => q.table === "tenant_members" && q.kind === "select" && has(q, "user_id") && q.filters.length === 1 },
    { name: "channels.findByWebhookId", match: (q) => q.table === "channel_accounts" && q.kind === "select" && has(q, "channel") && has(q, "webhook_id") && has(q, "status") && !has(q, "tenant_id") },
    // Phase 2 notices: a device (endpoint) is unique across businesses; the person reads their own notices on any business.
    { name: "push.removeEndpoint / subscribe (by endpoint)", match: (q) => q.table === "push_subscriptions" && q.kind === "delete" && has(q, "endpoint") && q.filters.length === 1 },
    { name: "push.latestNotices (by user)", match: (q) => q.table === "notifications" && q.kind === "select" && has(q, "user_id") && !has(q, "tenant_id") },
    // Platform console (lib/platform/*, after platformAdmins.isPlatformAdmin): read-only cross-tenant lists.
    { name: "platform.legalHolds (all tenants)", match: (q) => q.table === "conversations" && q.kind === "select" && has(q, "legal_hold") && !has(q, "tenant_id") },
    { name: "platform.audit (all tenants, by action prefix)", match: (q) => q.table === "audit_log" && q.kind === "select" && has(q, "action", "like") && !has(q, "tenant_id") },
    { name: "platform.demoTenantIds", match: (q) => q.table === "audit_log" && q.kind === "select" && q.filters.length === 1 && q.filters[0].col === "action" && q.filters[0].val === "demo.business" },
    { name: "audit.log (global row)", match: (q) => q.table === "audit_log" && q.kind === "insert" && !!q.rows?.length && q.rows.every((r) => r.tenant_id === null) },
  ];
  const tenantScoped = (q: Recorded): boolean => {
    // Global RPCs: the rate limiter and the platform-admin tenant list (tenants.listAll, CROSS-TENANT by design).
    if (q.kind === "rpc") return q.table === "rate_limit_hit" || q.table === "platform_tenant_overview" || q.table === "platform_stats" || UUID.test(String(q.args?.p_tenant ?? ""));
    if (q.table === "platform_admins") return q.kind === "select" && has(q, "user_id"); // global role lookup
    if (!TENANT_TABLES.includes(q.table)) {
      // tenants: by id / slug only, or the retention job's id listing; global counters are not tenant-owned.
      if (q.table === "tenants") return has(q, "id") || has(q, "slug") || (q.kind === "upsert" && !!q.rows?.every((r) => r.slug)) || (q.kind === "select" && q.columns === "id" && q.filters.length === 0);
      return q.table === "rate_limits" || q.table === "login_attempts";
    }
    if (q.kind === "insert" || q.kind === "upsert") return !!q.rows?.length && q.rows.every((r) => UUID.test(String(r.tenant_id ?? "")));
    return q.filters.some((f) => f.col === "tenant_id" && f.op === "eq" && UUID.test(String(f.val)));
  };

  it("every tenant-owned query is filtered by tenant_id (or is a documented cross-tenant lookup)", () => {
    expect(fake.log.length).toBeGreaterThan(500);
    const offenders = fake.log.filter((q) => !tenantScoped(q) && !CROSS_TENANT.some((c) => c.match(q)));
    expect(offenders).toEqual([]);
    // ...and the suite really exercised every tenant-owned table and every cross-tenant path.
    for (const t of TENANT_TABLES) expect(fake.log.some((q) => q.table === t), t).toBe(true);
    for (const c of CROSS_TENANT) expect(fake.log.some(c.match), c.name).toBe(true);
    for (const fn of ["rate_limit_hit", "usage_add", "conversation_touch", "retention_purge_tenant", "retention_delete_conversations", "platform_tenant_overview", "platform_stats", "platform_lift_legal_hold"])
      expect(fake.log.some((q) => q.kind === "rpc" && q.table === fn), fn).toBe(true);
  });
});
