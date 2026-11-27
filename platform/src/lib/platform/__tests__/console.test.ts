// Platform console, offline. Auth and data are mocked:
//  - every loader and every action is a 404 for tenant owners/admins/agents (cross-tenant negative) and never
//    touches the cross-tenant repo (data.platform / tenants.listAll) before the platform-admin check;
//  - actions validate input, need the typed short address for destructive steps, are rate limited and write an
//    audit row with codes only;
//  - pages render counts only (no end-customer data) and the pure helpers behave.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { AuthState } from "@/lib/auth/session";
import type { PlatformStats, PlatformTenantPatch, TenantOverview } from "@/lib/data/types";

const h = vi.hoisted(() => ({
  auth: { status: "anonymous" } as unknown,
  admins: new Set<string>(),
  calls: [] as string[],
  audit: [] as { tenantId: string; actor: string; action: string; detail: string }[],
  updates: [] as { id: string; patch: unknown }[],
  lifts: [] as unknown[][],
  windows: new Map<string, number>(),
  demo: new Set<string>(),
  deleted: [] as string[],
}));

vi.mock("next/navigation", () => ({
  notFound: () => { throw Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" }); },
  redirect: (url: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${url}` }); },
  usePathname: () => "/platform",
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({ getAuthState: async () => h.auth, logout: async () => {} }));
vi.mock("@/lib/security/rate-limit", () => ({
  hashKey: (p: string, v: string) => `${p}:${v}`,
  hit: async (key: string, limit: number, windowMs: number, now: number) => {
    const k = `${key}@${Math.floor(now / windowMs)}`;
    const n = (h.windows.get(k) ?? 0) + 1;
    h.windows.set(k, n);
    return { ok: n <= limit, retryAfterS: 0 };
  },
}));
vi.mock("@/lib/retention", () => ({ retentionDays: () => 90, legalHoldMaskDays: () => 365, outboxRetentionDays: () => 30 }));
vi.mock("@/lib/demo/business", () => ({
  deleteDemoBusiness: async (id: string) => {
    if (!h.demo.has(id)) return { ok: false, error: "not_demo" };
    h.deleted.push(id);
    return { ok: true };
  },
}));

const NOW = new Date("2026-11-23T12:00:00Z");
const base = { members: 2, connectedChannels: 1, aiMonthlyTokenCap: 100_000, createdAt: "2026-09-01T00:00:00Z" } as const;
const TENANTS: TenantOverview[] = [
  { ...base, id: "t-a", name: "Panadería Uno", slug: "panaderia-uno", plan: "pro", status: "active", conversationsThisMonth: 12, aiTokensThisMonth: 42_000 },
  { ...base, id: "t-b", name: "Taller Dos", slug: "taller-dos", plan: "free", status: "suspended", conversationsThisMonth: 0, aiTokensThisMonth: 0 },
  { ...base, id: "t-c", name: "Café Lleno", slug: "cafe-lleno", plan: "free", status: "active", conversationsThisMonth: 4, aiTokensThisMonth: 100_000 },
  { ...base, id: "t-d", name: "Demo Moda", slug: "demo-abc", plan: "free", status: "active", conversationsThisMonth: 1, aiTokensThisMonth: 85_000, createdAt: "2026-11-22T00:00:00Z" },
];
const STATS: PlatformStats = {
  tenants: { total: 4, active: 3, suspended: 1, deleted: 0, free: 3, pro: 1, business: 0 },
  byDay: [{ day: "2026-11-22", count: 3 }, { day: "2026-11-23", count: 5 }],
  waiting: 4, urgent: 1, urgentTenants: 1, oldestUrgentAt: "2026-11-23T11:35:00Z",
  channels: [{ channel: "telegram", status: "connected", count: 3 }, { channel: "whatsapp", status: "error", count: 1 }],
  channelErrors: [{ tenantId: "t-a", channel: "whatsapp" }],
  aiInputTokens: 2_000_000, aiOutputTokens: 400_000, legalHolds: 1, legalHoldTenants: 1,
  activity: [{ tenantId: "t-a", lastMessageAt: "2026-11-23T11:57:00Z" }, { tenantId: "t-c", lastMessageAt: "2026-10-01T00:00:00Z" }],
};

vi.mock("@/lib/data", () => ({
  getData: () => ({
    backend: "supabase",
    platformAdmins: {
      isPlatformAdmin: async (u: string) => { h.calls.push(`isPlatformAdmin:${u}`); return h.admins.has(u); },
      list: async () => { h.calls.push("platform.admins"); return [
        { userId: "u-platform", name: "Carla", email: "carla@example.test", since: "2026-11-19T00:00:00Z" },
        { userId: "u-other", name: "Otro", email: "otro@example.test", since: null },
      ]; },
    },
    tenants: {
      listAll: async () => { h.calls.push("listAll"); return { items: TENANTS, total: TENANTS.length, period: "2026-11-01" }; },
      get: async (id: string) => { const t = TENANTS.find((x) => x.id === id); return t ? { ...t } : null; },
    },
    members: {
      list: async () => [
        { userId: "o", tenantId: "t-a", role: "owner", name: "Dueña", email: "duena@example.test" },
        { userId: "g", tenantId: "t-a", role: "agent", name: "Agente", email: "agente-secreto@example.test" },
      ],
    },
    platform: {
      stats: async () => { h.calls.push("platform.stats"); return STATS; },
      demoTenantIds: async () => { h.calls.push("platform.demo"); return [...h.demo]; },
      aiReservedToday: async () => { h.calls.push("platform.ai"); return 2_050_000; },
      legalHolds: async () => { h.calls.push("platform.holds"); return [{ tenantId: "t-a", conversationId: "c-1", channel: "whatsapp", reason: "safety", createdAt: "2026-10-13T00:00:00Z" }]; },
      audit: async () => { h.calls.push("platform.audit"); return [
        { tenantId: "t-a", actor: "u-platform", action: "platform.tenant.ai_cap", detail: "2000000>3000000 season", createdAt: "2026-11-20T18:02:00Z" },
        { tenantId: "t-a", actor: "meta-deletion", action: "privacy.meta_deletion_request", detail: "code", createdAt: "2026-11-22T10:00:00Z" },
        { tenantId: null, actor: "u-platform", action: "platform.view", detail: "", createdAt: "2026-11-22T09:00:00Z" },
      ]; },
      updateTenant: async (id: string, patch: PlatformTenantPatch) => {
        h.calls.push("platform.update");
        const t = TENANTS.find((x) => x.id === id);
        if (!t) return null;
        h.updates.push({ id, patch });
        return { ...t, ...patch };
      },
      liftLegalHold: async (...a: unknown[]) => { h.calls.push("platform.lift"); h.lifts.push(a); return a[1] === "c-1"; },
    },
    audit: { log: async (tenantId: string, actor: string, action: string, detail = "") => { h.audit.push({ tenantId, actor, action, detail }); } },
  }),
}));

import {
  aiCostUsd, buildAlerts, changePlan, deleteDemoTenant, integrationStatus, isInactive, liftLegalHold, loadAuditLog, loadCompliance,
  loadOverview, loadSettings, loadTenantDetail, loadTenants, matchesFilter, parseFilter, projectMonth, reactivateTenant, setAiCap,
  suspendTenant, type TenantRow,
} from "@/lib/platform/console";
import { actorLabel, describeEvent } from "@/lib/platform/format";
import { makeT } from "@/lib/i18n";
import { consoleDict } from "@/lib/platform/console-dict";
import OverviewPage from "@/app/(platform)/platform/page";
import TenantPage from "@/app/(platform)/platform/tenants/[id]/page";
import CompliancePage from "@/app/(platform)/platform/compliance/page";
import AuditPage from "@/app/(platform)/platform/audit/page";
import SettingsPage from "@/app/(platform)/platform/settings/page";

const session = (userId: string, role: "owner" | "admin" | "agent"): AuthState => ({
  status: "ok", session: { userId, tenantId: "t-a", role, name: "Persona", email: `${userId}@example.test`, tenants: [{ id: "t-a", name: "Panadería Uno", role }] },
});
const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);
const rejection = async (p: Promise<unknown>) => p.then(() => { throw new Error("expected a rejection"); }, (e: { digest?: string }) => e.digest);
const t = makeT(consoleDict, "es");

beforeEach(() => {
  h.auth = { status: "anonymous" };
  h.admins = new Set(["u-platform"]);
  h.calls = []; h.audit = []; h.updates = []; h.lifts = []; h.windows = new Map(); h.demo = new Set(["t-d"]); h.deleted = [];
});

describe("access (cross-tenant negative)", () => {
  const everything = () => [
    loadOverview({}, NOW), loadTenants({}, NOW), loadTenantDetail("t-a", NOW), loadCompliance(NOW), loadAuditLog(NOW), loadSettings(NOW, {}),
    suspendTenant("t-a", "payment", "panaderia-uno"), reactivateTenant("t-b"), changePlan("t-a", "business", "upgrade"),
    setAiCap("t-a", 5, "season"), deleteDemoTenant("t-d", "demo-abc"), liftLegalHold("t-a", "c-1", "resolved"),
  ];
  for (const role of ["owner", "admin", "agent"] as const) {
    it(`a tenant ${role} gets a 404 everywhere and nothing cross-tenant runs`, async () => {
      h.auth = session(`u-${role}`, role);
      for (const p of everything()) expect(await rejection(p)).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
      expect(h.calls.filter((c) => c.startsWith("platform.") || c === "listAll")).toEqual([]);
      expect(h.audit).toEqual([]);
      expect(h.updates).toEqual([]);
    });
  }
  it("anonymous visitors too", async () => {
    for (const p of everything()) expect(await rejection(p)).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(h.calls.filter((c) => c.startsWith("platform."))).toEqual([]);
  });
});

describe("actions (platform admin)", () => {
  beforeEach(() => { h.auth = session("u-platform", "agent"); });

  it("suspend needs a known reason and the typed short address; audited with the code only", async () => {
    expect(await suspendTenant("t-a", "because I said", "panaderia-uno")).toEqual({ ok: false, error: "invalid" });
    expect(await suspendTenant("t-a", "payment", "panaderia")).toEqual({ ok: false, error: "confirm" });
    expect(h.updates).toEqual([]);
    expect(await suspendTenant("t-a", "payment", "  PANADERIA-UNO ")).toMatchObject({ ok: true });
    expect(h.updates).toEqual([{ id: "t-a", patch: { status: "suspended" } }]);
    expect(h.audit).toEqual([{ tenantId: "t-a", actor: "u-platform", action: "platform.tenant.suspended", detail: "payment" }]);
    expect(await suspendTenant("nope", "payment", "x")).toEqual({ ok: false, error: "not_found" });
  });

  it("reactivate, plan and AI cap are audited as codes (before>after reason)", async () => {
    expect(await reactivateTenant("t-b")).toMatchObject({ ok: true });
    expect(await changePlan("t-a", "gold", "upgrade")).toEqual({ ok: false, error: "invalid" });
    expect(await changePlan("t-a", "business", "upgrade")).toMatchObject({ ok: true });
    expect(await setAiCap("t-a", -5, "season")).toEqual({ ok: false, error: "invalid" });
    expect(await setAiCap("t-a", 3_000_000, "season")).toMatchObject({ ok: true });
    expect(h.audit.map((a) => [a.action, a.detail])).toEqual([
      ["platform.tenant.reactivated", ""], ["platform.tenant.plan", "pro>business upgrade"], ["platform.tenant.ai_cap", "100000>3000000 season"],
    ]);
  });

  it("delete demo: only demos, with the typed address", async () => {
    expect(await deleteDemoTenant("t-d", "wrong")).toEqual({ ok: false, error: "confirm" });
    expect(await deleteDemoTenant("t-a", "panaderia-uno")).toEqual({ ok: false, error: "not_demo" });
    expect(await deleteDemoTenant("t-d", "demo-abc")).toEqual({ ok: true });
    expect(h.deleted).toEqual(["t-d"]);
  });

  it("lifting a legal hold needs a reason code and passes the admin as actor", async () => {
    expect(await liftLegalHold("t-a", "c-1", "whatever")).toEqual({ ok: false, error: "invalid" });
    expect(await liftLegalHold("t-a", "c-1", "resolved")).toEqual({ ok: true });
    expect(h.lifts).toEqual([["t-a", "c-1", "u-platform", "resolved"]]);
    expect(await liftLegalHold("t-a", "c-9", "resolved")).toEqual({ ok: false, error: "not_found" });
  });

  it("is rate limited per admin (60 per hour)", async () => {
    for (let i = 0; i < 60; i++) await reactivateTenant("t-b");
    expect(await reactivateTenant("t-b")).toEqual({ ok: false, error: "rate_limited" });
  });
});

describe("loaders and pages (platform admin)", () => {
  beforeEach(() => { h.auth = session("u-platform", "owner"); });

  it("overview: KPIs, alerts and cost; counts only", async () => {
    const v = await loadOverview({ days: "30" }, NOW);
    expect(v.days).toBe(30);
    expect(v.activeTenants).toBe(2); // the demo and the suspended one do not count
    expect(v.demoTenants).toBe(1);
    expect(v.conversations).toBe(8);
    expect(v.aiTodayTokens).toBe(2_050_000);
    expect(v.costMonth).toBeCloseTo(0.4, 5); // 2M in x 0.10 + 0.4M out x 0.50
    expect(v.alerts.map((a) => [a.kind, a.tenantId])).toEqual([["channel_error", "t-a"], ["cap_reached", "t-c"], ["near_cap", "t-d"], ["inactive", "t-c"]]);
    const page = html(await OverviewPage({ searchParams: Promise.resolve({}) }));
    expect(page).toContain("Resumen de la plataforma");
    expect(page).toContain("WhatsApp con error");
    expect(page).toContain("Llegó a su tope de IA (100%)");
    expect(page).toContain('href="/platform/tenants/t-a"');
    expect(page).toContain("Por privacidad");
  });

  it("tenant filters", async () => {
    expect((await loadTenants({ filter: "suspended" }, NOW)).items.map((x) => x.id)).toEqual(["t-b"]);
    expect((await loadTenants({ filter: "demo" }, NOW)).items.map((x) => x.id)).toEqual(["t-d"]);
    expect((await loadTenants({ filter: "near_cap" }, NOW)).items.map((x) => x.id)).toEqual(["t-c", "t-d"]);
    expect((await loadTenants({ filter: "inactive" }, NOW)).items.map((x) => x.id)).toEqual(["t-c"]);
    const all = await loadTenants({ filter: "bogus" }, NOW);
    expect(all.filter).toBe("all");
    expect(all.counts).toMatchObject({ all: 4, active: 2, suspended: 1, demo: 1, inactive: 1, near_cap: 2 });
  });

  it("tenant detail: owner contact only, no other member's email; unknown id is a 404", async () => {
    const page = html(await TenantPage({ params: Promise.resolve({ id: "t-a" }) }));
    expect(page).toContain("Panadería Uno");
    expect(page).toContain("duena@example.test");
    expect(page).not.toContain("agente-secreto@example.test");
    expect(page).toContain("Cambió el tope de IA · 2M → 3M · Temporada alta");
    expect(page).toContain("Suspender");
    expect(await rejection(TenantPage({ params: Promise.resolve({ id: "nope" }) }))).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("compliance and log pages", async () => {
    const c = html(await CompliancePage());
    expect(c).toContain("Solicitud de borrado desde Meta");
    expect(c).toMatch(/WhatsApp · seguridad · desde hace \d+ día\(s\)/); // days counted from the real date
    expect(c).toContain("Levantar…");
    const a = html(await AuditPage());
    expect(a).toContain("Cambió el tope de IA");
    expect(a).not.toContain("Entró a la consola"); // platform.view is hidden
  });

  it("settings: admins, AI, retention and integrations; never a secret value", async () => {
    const env = {
      ANTHROPIC_API_KEY: "sk-ant-SECRET-123", META_APP_SECRET: "meta-SECRET-456", META_VERIFY_TOKEN: "verify-SECRET-789",
      PUBLIC_URL: "https://conversa.example", PLATFORM_DAILY_TOKEN_CAP: "4000000", AI_PRICE_INPUT_PER_MTOK: "0.2",
    };
    const v = await loadSettings(NOW, env);
    expect(v.admins.map((a) => a.userId)).toEqual(["u-platform", "u-other"]);
    expect(v.ai).toMatchObject({ provider: "anthropic", model: "claude-haiku-5-5", dailyCap: 4_000_000, reservedToday: 2_050_000, newTenantCap: 300_000, customPrices: true });
    expect(v.ai.prices).toEqual({ input: 0.2, output: 0.5 });
    expect(v.retention).toEqual({ conversations: 90, legalHoldMask: 365, outbox: 30 });
    expect(JSON.stringify(v)).not.toMatch(/SECRET/);
    for (const [k, val] of Object.entries(env)) vi.stubEnv(k, val);
    let page: string;
    try { page = html(await SettingsPage()); } finally { vi.unstubAllEnvs(); }
    expect(page).toContain("Anthropic (Claude)");
    expect(page).toContain("$0.20 entrada");
    expect(page).toContain("Administradores de la plataforma");
    expect(page).toContain("carla@example.test");
    expect(page).toContain("(tú)");
    expect(page).toContain("insert into public.platform_admins");
    expect(page).toContain("Retención de datos");
    expect(page).toContain("Integraciones");
    for (const secret of [env.ANTHROPIC_API_KEY, env.META_APP_SECRET, env.META_VERIFY_TOKEN, "sk-ant"]) expect(page).not.toContain(secret);
  });
});

describe("pure helpers", () => {
  it("integration status: booleans only, unsigned webhooks and plain-http URLs are flagged", () => {
    const st = (env: Record<string, string>) => Object.fromEntries(integrationStatus(env).map((i) => [i.key, i.state]));
    expect(st({})).toMatchObject({ ai: "missing", meta: "missing", shopify: "missing", publicUrl: "missing", unsigned: "ok" });
    expect(st({ OPENAI_API_KEY: "x", META_APP_SECRET: "x", PUBLIC_URL: "http://x", ALLOW_UNSIGNED_WEBHOOKS: "1" }))
      .toMatchObject({ ai: "ok", meta: "missing", publicUrl: "warn", unsigned: "warn" });
    expect(st({ SHOPIFY_API_KEY: "k", SHOPIFY_API_SECRET: "s", META_APP_SECRET: "a", META_VERIFY_TOKEN: "b", PUBLIC_URL: "https://x" }))
      .toMatchObject({ shopify: "ok", meta: "ok", publicUrl: "ok" });
    expect(JSON.stringify(integrationStatus({ ANTHROPIC_API_KEY: "sk-ant-zzz" }))).not.toContain("zzz");
  });

  const row = (p: Partial<TenantRow>): TenantRow => ({ ...TENANTS[0], demo: false, lastActivityAt: null, aiPct: 0, ...p });
  it("inactive: 30 days without customer messages, or never and older than 30 days", () => {
    expect(isInactive(row({ lastActivityAt: "2026-10-20T00:00:00Z" }), NOW)).toBe(true);
    expect(isInactive(row({ lastActivityAt: "2026-11-01T00:00:00Z" }), NOW)).toBe(false);
    expect(isInactive(row({ createdAt: "2026-11-10T00:00:00Z" }), NOW)).toBe(false);
    expect(isInactive(row({ createdAt: "2026-09-10T00:00:00Z" }), NOW)).toBe(true);
  });
  it("filters and alerts", () => {
    expect(parseFilter("demo")).toBe("demo");
    expect(parseFilter("<script>")).toBe("all");
    expect(matchesFilter(row({ status: "deleted" }), "all", NOW)).toBe(false);
    expect(matchesFilter(row({ demo: true }), "active", NOW)).toBe(false);
    const alerts = buildAlerts([row({ id: "x", status: "suspended", aiPct: 100 })], { channelErrors: [{ tenantId: "x", channel: "telegram" }] }, NOW);
    expect(alerts.map((a) => a.kind)).toEqual(["channel_error"]); // a suspended business gets no cap alert
  });
  it("cost and projection", () => {
    expect(aiCostUsd(1_000_000, 1_000_000, { input: 0.1, output: 0.5 })).toBeCloseTo(0.6);
    expect(projectMonth(1, new Date("2026-11-16T00:00:00Z"))).toBeCloseTo(2, 5); // 15 of 30 days
  });
  it("audit lines are codes turned into words; actors have no names", () => {
    expect(describeEvent("platform.tenant.plan", "free>pro upgrade", t)).toBe("Cambió el plan · Gratis → Pro · Subió de plan");
    expect(describeEvent("platform.tenant.suspended", "payment", t)).toBe("Suspendió el negocio · Falta de pago");
    expect(describeEvent("platform.legal_hold.lifted", "c-1 no_risk", t)).toBe("Levantó una retención legal · No había riesgo real");
    expect(describeEvent("custom.thing", "", t)).toBe("custom.thing");
    expect(actorLabel("u-1", "platform.tenant.plan", "u-1", t)).toBe("Tú");
    expect(actorLabel("u-2", "platform.tenant.plan", "u-1", t)).toBe("Administrador");
    expect(actorLabel("u-3", "privacy.customer_deleted", "u-1", t)).toBe("Equipo del negocio");
    expect(actorLabel("meta-deletion", "privacy.meta_deletion_request", "u-1", t)).toBe("Meta");
  });
  it("every channel (and the simulator) has a name", () => {
    for (const ch of ["telegram", "whatsapp", "instagram", "messenger", "manychat", "simulator"]) expect(t(`ch.${ch}`)).not.toBe(`ch.${ch}`);
  });
  it("every Spanish key has an English one", () => {
    expect(Object.keys(consoleDict.en).sort()).toEqual(Object.keys(consoleDict.es).sort());
  });
});
