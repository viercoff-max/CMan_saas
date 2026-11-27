// Platform-admin screen + public site, offline. The auth and data layers are mocked:
//  - /platform is a 404 for anonymous users and for owners/admins/agents of tenants (cross-tenant negative), and
//    tenants.listAll (CROSS-TENANT) is never called unless platformAdmins.isPlatformAdmin(userId) said yes first.
//  - "platform.view" is audited (global row) at most once per admin per hour.
//  - "/" redirects signed-in users to /dashboard; legal pages render the draft banner and are noindex.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import type { AuthState } from "@/lib/auth/session";
import type { TenantListQuery, TenantOverview } from "@/lib/data/types";

const h = vi.hoisted(() => ({
  auth: { status: "anonymous" } as unknown,
  admins: new Set<string>(),
  calls: [] as string[],
  listArgs: [] as unknown[],
  audit: [] as { tenantId: string; actor: string; action: string }[],
  windows: new Map<string, number>(),
  locale: "es",
  adminThrows: false,
}));

vi.mock("next/navigation", () => ({
  notFound: () => { throw Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" }); },
  redirect: (url: string) => { throw Object.assign(new Error("NEXT_REDIRECT"), { digest: `NEXT_REDIRECT;replace;${url}`, url }); },
  usePathname: () => "/platform/tenants",
  useRouter: () => ({ refresh: () => {}, push: () => {} }),
}));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "locale" ? { name: n, value: h.locale } : undefined), set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => {}, revalidateTag: () => {} }));
vi.mock("@/lib/auth", () => ({
  getAuthState: async () => { h.calls.push("auth"); return h.auth; },
  logout: async () => {},
}));
vi.mock("@/lib/security/rate-limit", () => ({
  hashKey: (p: string, v: string) => `${p}:${v}`,
  // Same fixed-window semantics as the real limiter.
  hit: async (key: string, limit: number, windowMs: number, now: number) => {
    const k = `${key}@${Math.floor(now / windowMs)}`;
    const n = (h.windows.get(k) ?? 0) + 1;
    h.windows.set(k, n);
    return { ok: n <= limit, retryAfterS: 0 };
  },
}));

const TENANTS: TenantOverview[] = [
  { id: "t-a", name: "Panadería Uno", slug: "panaderia-uno", plan: "pro", status: "active", aiMonthlyTokenCap: 100_000, createdAt: "2026-10-01T00:00:00Z", members: 3, conversationsThisMonth: 12, connectedChannels: 1, aiTokensThisMonth: 42_000 },
  { id: "t-b", name: "Taller Dos", slug: "taller-dos", plan: "free", status: "suspended", aiMonthlyTokenCap: 10_000, createdAt: "2026-11-02T00:00:00Z", members: 1, conversationsThisMonth: 0, connectedChannels: 0, aiTokensThisMonth: 10_500 },
];

vi.mock("@/lib/data", () => ({
  getData: () => ({
    backend: "sqlite",
    platformAdmins: {
      isPlatformAdmin: async (userId: string) => {
        h.calls.push(`isPlatformAdmin:${userId}`);
        if (h.adminThrows) throw new Error("db down");
        return h.admins.has(userId);
      },
    },
    tenants: {
      listAll: async (q: TenantListQuery) => {
        h.calls.push("listAll");
        h.listArgs.push(q);
        return { items: TENANTS, total: TENANTS.length, period: "2026-11-01" };
      },
      get: async () => null,
    },
    platform: {
      stats: async () => { h.calls.push("platform.stats"); return (await import("@/lib/data/platform-rules")).emptyPlatformStats(); },
      demoTenantIds: async () => { h.calls.push("platform.demoTenantIds"); return []; },
    },
    audit: { log: async (tenantId: string, actor: string, action: string) => { h.audit.push({ tenantId, actor, action }); } },
  }),
}));

import { aiLevel, aiPercent, compactNumber, needsAttention, parsePlatformQuery, PLATFORM_VIEW_ACTION, recordPlatformView } from "@/lib/platform/admin";
import { loadTenants as loadPlatformView } from "@/lib/platform/console";
import { AUDIT_GLOBAL_TENANT } from "@/lib/data/types";
import PlatformPage from "@/app/(platform)/platform/tenants/page";
import PlatformLayout from "@/app/(platform)/layout";
import LandingPage, { generateMetadata as landingMeta } from "@/app/(marketing)/page";
import PrivacyPage, { generateMetadata as privacyMeta } from "@/app/(marketing)/privacidad/page";
import TermsPage, { generateMetadata as termsMeta } from "@/app/(marketing)/terminos/page";
import DeletionPage from "@/app/(marketing)/eliminar-datos/page";
import PricingPage from "@/app/(marketing)/precios/page";
import { PLATFORM_BRAND, platformDisplayName } from "@/lib/platform/brand";

const session = (userId: string, role: "owner" | "admin" | "agent", tenantId = "t-a"): AuthState => ({
  status: "ok",
  session: { userId, tenantId, role, name: "Persona", email: `${userId}@example.test`, tenants: [{ id: tenantId, name: "Panadería Uno", role }] },
});
const sp = (v: Record<string, string> = {}) => ({ searchParams: Promise.resolve(v) });
const html = (el: unknown) => renderToStaticMarkup(el as ReactElement);
const rejection = async (p: Promise<unknown>) => p.then(() => { throw new Error("expected a rejection"); }, (e: { digest?: string }) => e.digest);

beforeEach(() => {
  h.auth = { status: "anonymous" };
  h.admins = new Set(["u-platform"]);
  h.calls = []; h.listArgs = []; h.audit = []; h.windows = new Map();
  h.locale = "es"; h.adminThrows = false;
});

describe("/platform access", () => {
  it("404 for anonymous visitors, without touching listAll", async () => {
    expect(await rejection(loadPlatformView({}))).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(await rejection(PlatformPage(sp()))).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(h.calls).not.toContain("listAll");
    expect(h.calls).not.toContain("platform.stats");
  });

  for (const role of ["owner", "admin", "agent"] as const) {
    it(`404 for a tenant ${role} who is not a platform admin (cross-tenant negative)`, async () => {
      h.auth = session(`u-${role}`, role);
      expect(await rejection(PlatformPage(sp()))).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
      expect(await rejection(PlatformLayout({ children: null }))).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
      expect(h.calls).toContain(`isPlatformAdmin:u-${role}`);
      expect(h.calls).not.toContain("listAll");
      expect(h.audit).toEqual([]);
    });
  }

  it("404 for a signed-in user without a business who is not a platform admin", async () => {
    h.auth = { status: "no_tenant", user: { id: "u-new", email: "new@example.test", name: "" } };
    expect(await rejection(loadPlatformView({}))).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(h.calls).not.toContain("listAll");
  });

  it("fails closed (404) when the platform-admin check errors", async () => {
    h.auth = session("u-platform", "owner");
    h.adminThrows = true;
    expect(await rejection(loadPlatformView({}))).toBe("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(h.calls).not.toContain("listAll");
  });

  it("platform admin: listAll is called only after the check, with paging and search", async () => {
    h.auth = session("u-platform", "agent", "t-b"); // a platform admin may be a plain agent somewhere: still allowed
    const v = await loadPlatformView({ q: "  pana ", page: "2" }, new Date("2026-11-19T12:00:00Z"));
    expect(h.calls.indexOf("isPlatformAdmin:u-platform")).toBeGreaterThanOrEqual(0);
    expect(h.calls.indexOf("listAll")).toBeGreaterThan(h.calls.indexOf("isPlatformAdmin:u-platform"));
    expect(h.calls.indexOf("platform.stats")).toBeGreaterThan(h.calls.indexOf("isPlatformAdmin:u-platform"));
    expect(h.listArgs[0]).toMatchObject({ limit: 200, offset: 0 }); // every business, then search / filter / page here
    expect(v.q).toBe("pana");
    expect(v.items.map((x) => x.id)).toEqual(["t-a"]);
    expect(v.page).toBe(1); // page 2 of 1 clamps
    expect(v.pages).toBe(1);
  });

  it("platform admin without a business also gets in", async () => {
    h.auth = { status: "no_tenant", user: { id: "u-platform", email: "p@example.test", name: "Plataforma" } };
    expect((await loadPlatformView({})).admin.userId).toBe("u-platform");
  });

  it("renders the tenant table (platform brand, badges, AI bar, counts only)", async () => {
    h.auth = session("u-platform", "owner");
    const page = html(await PlatformPage(sp()));
    expect(page).toContain("Negocios");
    expect(page).toContain("Panadería Uno");
    expect(page).toContain("Taller Dos");
    expect(page).toContain("Suspendido");
    expect(page).toContain("Tope de IA");
    expect(page).toContain('aria-valuenow="42"');
    expect(page).toContain("Sin conectar");
    expect(page).toContain('href="/platform/tenants/t-a"');
    const shell = html(await PlatformLayout({ children: null }));
    expect(shell).toContain(PLATFORM_BRAND.name);
    expect(shell).toContain(">hola<"); // "hola conversa" wordmark
    expect(shell).not.toContain("nombre provisional"); // the name is final
    h.locale = "en";
    expect(html(await PlatformPage(sp()))).toContain("Businesses");
  });
});

describe("platform.view audit", () => {
  it("one global row per admin per hour", async () => {
    h.auth = session("u-platform", "owner");
    const t0 = new Date("2026-11-19T10:05:00Z");
    await loadPlatformView({}, t0);
    await loadPlatformView({}, new Date(t0.getTime() + 20 * 60_000));
    expect(h.audit).toEqual([{ tenantId: AUDIT_GLOBAL_TENANT, actor: "u-platform", action: PLATFORM_VIEW_ACTION }]);
    await loadPlatformView({}, new Date(t0.getTime() + 61 * 60_000));
    expect(h.audit).toHaveLength(2);
    expect(await recordPlatformView("u-other", t0.getTime())).toBe(true); // separate per admin
  });
});

describe("helpers", () => {
  it("parses search params safely", () => {
    expect(parsePlatformQuery({})).toEqual({ q: "", page: 1 });
    expect(parsePlatformQuery({ q: ["a", "b"], page: "-3" })).toEqual({ q: "a", page: 1 });
    expect(parsePlatformQuery({ q: "x".repeat(300), page: "99999999" })).toEqual({ q: "x".repeat(100), page: 10_000 });
    expect(parsePlatformQuery({ q: "a\u0000b", page: "abc" })).toEqual({ q: "ab", page: 1 });
  });
  it("AI usage percent, level and attention", () => {
    expect(aiPercent(TENANTS[0])).toBe(42);
    expect(aiPercent(TENANTS[1])).toBe(100);
    expect(aiPercent({ aiMonthlyTokenCap: 0, aiTokensThisMonth: 0 })).toBe(0);
    expect(aiPercent({ aiMonthlyTokenCap: 0, aiTokensThisMonth: 5 })).toBe(100);
    expect([aiLevel(10), aiLevel(85), aiLevel(100)]).toEqual(["ok", "high", "full"]);
    expect(needsAttention(TENANTS[0])).toBe(false);
    expect(needsAttention(TENANTS[1])).toBe(true);
    expect([compactNumber(950), compactNumber(1234), compactNumber(42_000), compactNumber(2_500_000)]).toEqual(["950", "1.2k", "42k", "2.5M"]);
  });
  it("platform name comes from one config", () => {
    expect(PLATFORM_BRAND.provisional).toBe(false);
    expect(platformDisplayName("es")).toBe(PLATFORM_BRAND.name);
  });
});

describe("public site", () => {
  it("'/' redirects signed-in users to /dashboard", async () => {
    h.auth = session("u-owner", "owner");
    expect(await rejection(LandingPage())).toBe("NEXT_REDIRECT;replace;/dashboard");
    h.auth = { status: "no_tenant", user: { id: "u-new", email: "n@example.test", name: "" } };
    expect(await rejection(LandingPage())).toBe("NEXT_REDIRECT;replace;/dashboard");
  });

  it("'/' shows the landing with both CTAs to anonymous visitors, noindex", async () => {
    const page = html(await LandingPage());
    expect(page).toContain('href="/signup"');
    expect(page).toContain('href="/precios"'); // no sales contact configured yet: the second action is the plans page
    expect(page).not.toContain("mailto:");
    expect(page).toContain("Crear cuenta");
    expect(page).toContain("Tu soporte contesta");
    expect(page).toContain("Telegram");
    expect(page).toContain("Correo");
    expect(page).toContain("Próximamente");
    // The inbox and timeline examples only show channels that work today.
    expect(page).not.toMatch(/ch_(instagram|messenger|email)[^"]*"[^>]*>[IM@]<\/span><div class="min-w-0"/);
    expect(page).not.toMatch(/\$\s?\d/); // still no prices
    expect((await landingMeta()).robots).toMatchObject({ index: false, follow: false });
  });

  it("pricing has no prices and no checkout", async () => {
    const page = html(await PricingPage());
    expect(page.match(/Precio por definir/g)).toHaveLength(3);
    for (const plan of ["Gratis", "Pro", "Negocio"]) expect(page).toContain(plan);
    expect(page).not.toMatch(/\$\s?\d/);
  });

  it("legal pages render the draft banner (es + en) and are noindex", async () => {
    for (const P of [PrivacyPage, TermsPage, DeletionPage]) {
      h.locale = "es";
      expect(html(await P())).toContain("Borrador: debe revisarlo un abogado antes de publicarse");
      h.locale = "en";
      expect(html(await P())).toContain("Draft: a lawyer must review it");
    }
    h.locale = "es";
    expect((await privacyMeta()).robots).toMatchObject({ index: false });
    expect((await termsMeta()).robots).toMatchObject({ index: false });
    const privacy = html(await PrivacyPage());
    for (const word of ["LFPDPPP", "Supabase", "Vercel", "Anthropic", "Telegram", "Meta", "90 días", "Cookies", "ARCO"]) expect(privacy).toContain(word);
    expect(html(await DeletionPage())).toContain("/api/webhooks/meta/data-deletion?code=");
  });
});
