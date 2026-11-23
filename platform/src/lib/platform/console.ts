// Platform console (owner of the platform): overview, businesses with filters, business detail, compliance, log.
// SERVER ONLY. Security contract, same as admin.ts: every loader and action calls requirePlatformAdmin() (404 for
// anyone else) BEFORE any cross-tenant read or write. Counts and configuration only: never message text, customer
// names or contact data of a business's customers. Every write leaves an audit row (codes only, no free text).
import { getData } from "../data";
import { DataValidationError } from "../data/errors";
import {
  LEGAL_HOLD_LIFT_REASONS, type LegalHoldRow, type Member, type PlatformAuditRow, type PlatformStats, type TenantInfo,
  type TenantOverview, type TenantPlan,
} from "../data/types";
import { hashKey, hit } from "../security/rate-limit";
import { platformDailyCap } from "../engine/spend";
import { deleteDemoBusiness } from "../demo/business";
import { retentionDays } from "../retention";
import { aiPercent, parsePlatformQuery, recordPlatformView, requirePlatformAdmin, type PlatformAdmin } from "./admin";

const DAY_MS = 86_400_000;
export const INACTIVE_DAYS = 30;
export const NEAR_CAP_PCT = 80;
const MAX_TENANTS = 1000;

// ---------------------------------------------------------------- pure helpers

export const TENANT_FILTERS = ["all", "active", "suspended", "demo", "inactive", "near_cap"] as const;
export type TenantFilter = (typeof TENANT_FILTERS)[number];
export const parseFilter = (v: unknown): TenantFilter =>
  (TENANT_FILTERS as readonly string[]).includes(String(v)) ? (v as TenantFilter) : "all";

export interface TenantRow extends TenantOverview { demo: boolean; lastActivityAt: string | null; aiPct: number }

/** No real-customer message in INACTIVE_DAYS days, and the business is older than that. */
export function isInactive(t: Pick<TenantRow, "lastActivityAt" | "createdAt">, now: Date): boolean {
  const cutoff = now.getTime() - INACTIVE_DAYS * DAY_MS;
  const last = t.lastActivityAt ? Date.parse(t.lastActivityAt) : NaN;
  if (!Number.isNaN(last)) return last < cutoff;
  const created = Date.parse(t.createdAt);
  return !Number.isNaN(created) && created < cutoff;
}

export function matchesFilter(t: TenantRow, f: TenantFilter, now: Date): boolean {
  switch (f) {
    case "active": return t.status === "active" && !t.demo;
    case "suspended": return t.status === "suspended";
    case "demo": return t.demo;
    case "inactive": return t.status === "active" && isInactive(t, now);
    case "near_cap": return t.aiPct >= NEAR_CAP_PCT;
    default: return t.status !== "deleted";
  }
}

export function filterCounts(rows: TenantRow[], now: Date): Record<TenantFilter, number> {
  const out = {} as Record<TenantFilter, number>;
  for (const f of TENANT_FILTERS) out[f] = rows.filter((r) => matchesFilter(r, f, now)).length;
  return out;
}

export type AlertKind = "channel_error" | "cap_reached" | "near_cap" | "inactive" | "urgent";
export interface Alert { kind: AlertKind; severity: "bad" | "warn" | "info"; tenantId: string; tenantName: string; channel?: string; pct?: number; days?: number }

/** Things the owner should look at, most severe first (max 20). */
export function buildAlerts(rows: TenantRow[], stats: Pick<PlatformStats, "channelErrors">, now: Date): Alert[] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const out: Alert[] = [];
  for (const e of stats.channelErrors) {
    const t = byId.get(e.tenantId);
    if (t && t.status !== "deleted") out.push({ kind: "channel_error", severity: "bad", tenantId: t.id, tenantName: t.name, channel: e.channel });
  }
  for (const t of rows) {
    if (t.status !== "active") continue;
    if (t.aiPct >= 100) out.push({ kind: "cap_reached", severity: "warn", tenantId: t.id, tenantName: t.name, pct: t.aiPct });
    else if (t.aiPct >= NEAR_CAP_PCT) out.push({ kind: "near_cap", severity: "warn", tenantId: t.id, tenantName: t.name, pct: t.aiPct });
    if (!t.demo && isInactive(t, now)) {
      const ref = Date.parse(t.lastActivityAt ?? t.createdAt);
      out.push({ kind: "inactive", severity: "info", tenantId: t.id, tenantName: t.name, days: Math.floor((now.getTime() - ref) / DAY_MS) });
    }
  }
  const rank = { bad: 0, warn: 1, info: 2 } as const;
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]).slice(0, 20);
}

/** USD per million tokens; defaults are Claude Haiku 5.5 list prices (the engine's model). Env overrides them. */
export function aiPrices(env: Record<string, string | undefined> = process.env): { input: number; output: number } {
  const read = (v: string | undefined, d: number) => { const n = Number(v); return v && Number.isFinite(n) && n >= 0 ? n : d; };
  return { input: read(env.AI_PRICE_INPUT_PER_MTOK, 0.1), output: read(env.AI_PRICE_OUTPUT_PER_MTOK, 0.5) };
}
export function aiCostUsd(input: number, output: number, p = aiPrices()): number {
  return (input / 1e6) * p.input + (output / 1e6) * p.output;
}
/** Straight-line projection of this month's cost from the days elapsed (UTC). */
export function projectMonth(cost: number, now: Date): number {
  const days = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0)).getUTCDate();
  const elapsed = (now.getTime() - Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)) / DAY_MS;
  return elapsed > 0 ? (cost / elapsed) * days : cost;
}

// ---------------------------------------------------------------- loaders (admin only)

async function allTenantRows(now: Date): Promise<{ rows: TenantRow[]; stats: PlatformStats; period: string }> {
  const data = getData();
  const [stats, demoIds] = await Promise.all([data.platform.stats({ now, days: 30 }), data.platform.demoTenantIds()]);
  const items: TenantOverview[] = [];
  let period = "";
  for (let offset = 0; offset < MAX_TENANTS; offset += 200) {
    const page = await data.tenants.listAll({ limit: 200, offset, now });
    period = page.period;
    items.push(...page.items);
    if (items.length >= page.total || page.items.length === 0) break;
  }
  const demo = new Set(demoIds);
  const last = new Map(stats.activity.map((a) => [a.tenantId, a.lastMessageAt]));
  const rows = items.map((t) => ({ ...t, demo: demo.has(t.id), lastActivityAt: last.get(t.id) ?? null, aiPct: aiPercent(t) }));
  return { rows, stats, period };
}

export interface OverviewView {
  admin: PlatformAdmin; days: 7 | 30; stats: PlatformStats; period: string;
  activeTenants: number; newTenants: number; demoTenants: number; conversations: number;
  aiTodayTokens: number; aiDailyCap: number; costMonth: number; costProjection: number;
  alerts: Alert[];
}

export async function loadOverview(sp: Record<string, string | string[] | undefined>, now = new Date()): Promise<OverviewView> {
  const admin = await requirePlatformAdmin();
  await recordPlatformView(admin.userId, now.getTime());
  const days = String(Array.isArray(sp.days) ? sp.days[0] : sp.days) === "30" ? 30 : 7;
  const { rows, stats, period } = await allTenantRows(now);
  const ranged = await getData().platform.stats({ now, days });
  const since = now.getTime() - days * DAY_MS;
  const costMonth = aiCostUsd(stats.aiInputTokens, stats.aiOutputTokens);
  return {
    admin, days, period, stats: { ...stats, byDay: ranged.byDay },
    activeTenants: rows.filter((r) => r.status === "active" && !r.demo).length,
    newTenants: rows.filter((r) => Date.parse(r.createdAt) >= since).length,
    demoTenants: rows.filter((r) => r.demo).length,
    conversations: ranged.byDay.reduce((s, d) => s + d.count, 0),
    aiTodayTokens: await getData().platform.aiReservedToday(now), aiDailyCap: platformDailyCap(),
    costMonth, costProjection: projectMonth(costMonth, now),
    alerts: buildAlerts(rows, stats, now),
  };
}

export interface TenantsView {
  admin: PlatformAdmin; filter: TenantFilter; q: string; page: number; pages: number; total: number;
  items: TenantRow[]; counts: Record<TenantFilter, number>; period: string;
}
export const TENANTS_PAGE = 25;

export async function loadTenants(sp: Record<string, string | string[] | undefined>, now = new Date()): Promise<TenantsView> {
  const admin = await requirePlatformAdmin();
  await recordPlatformView(admin.userId, now.getTime());
  const { q, page: pageN } = parsePlatformQuery(sp);
  const filter = parseFilter(Array.isArray(sp.filter) ? sp.filter[0] : sp.filter);
  const { rows, period } = await allTenantRows(now);
  const needle = q.toLowerCase();
  const searched = needle ? rows.filter((r) => r.name.toLowerCase().includes(needle) || r.slug.toLowerCase().includes(needle)) : rows;
  const matched = searched.filter((r) => matchesFilter(r, filter, now));
  const pages = Math.max(1, Math.ceil(matched.length / TENANTS_PAGE));
  const page = Math.min(pageN, pages);
  return {
    admin, filter, q, page, pages, total: matched.length, period,
    items: matched.slice((page - 1) * TENANTS_PAGE, page * TENANTS_PAGE), counts: filterCounts(searched, now),
  };
}

export interface TenantDetailView {
  admin: PlatformAdmin; tenant: TenantRow; stats: PlatformStats; members: Pick<Member, "role" | "name" | "email">[];
  channels: { channel: string; status: string }[]; holds: LegalHoldRow[]; log: PlatformAuditRow[];
  costMonth: number;
}

/** null = no such tenant (the page shows a 404). */
export async function loadTenantDetail(tenantId: string, now = new Date()): Promise<TenantDetailView | null> {
  const admin = await requirePlatformAdmin();
  const data = getData();
  const base = await data.tenants.get(tenantId).catch(() => null);
  if (!base) return null;
  const { rows } = await allTenantRows(now);
  const tenant = rows.find((r) => r.id === base.id);
  if (!tenant) return null;
  const [stats, members, holds, log] = await Promise.all([
    data.platform.stats({ now, days: 14, tenantId: tenant.id }),
    data.members.list(tenant.id).catch(() => [] as Member[]),
    data.platform.legalHolds({ tenantId: tenant.id }),
    data.platform.audit({ prefixes: ["platform.", "demo.", "privacy."], tenantId: tenant.id, limit: 30 }),
  ]);
  return {
    admin, tenant, stats, holds, log,
    // The owner's contact is the platform's own customer record (not an end customer's data).
    members: members.map((m) => ({ role: m.role, name: m.name, email: m.role === "owner" ? m.email : "" })),
    channels: stats.channels.map(({ channel, status }) => ({ channel, status })),
    costMonth: aiCostUsd(stats.aiInputTokens, stats.aiOutputTokens),
  };
}

export interface ComplianceView {
  admin: PlatformAdmin; holds: (LegalHoldRow & { tenantName: string; ageDays: number })[];
  requests: (PlatformAuditRow & { tenantName: string })[]; requestsThisMonth: number;
  retentionDays: number;
}

export async function loadCompliance(now = new Date()): Promise<ComplianceView> {
  const admin = await requirePlatformAdmin();
  const data = getData();
  const [{ rows }, holds, requests] = await Promise.all([
    allTenantRows(now), data.platform.legalHolds(), data.platform.audit({ prefixes: ["privacy."], limit: 100 }),
  ]);
  const name = new Map(rows.map((r) => [r.id, r.name]));
  const month = now.toISOString().slice(0, 7);
  return {
    admin,
    holds: holds.map((h) => ({ ...h, tenantName: name.get(h.tenantId) ?? "—", ageDays: Math.max(0, Math.floor((now.getTime() - Date.parse(h.createdAt)) / DAY_MS)) })),
    requests: requests.map((r) => ({ ...r, tenantName: r.tenantId ? name.get(r.tenantId) ?? "—" : "—" })),
    requestsThisMonth: requests.filter((r) => r.createdAt.startsWith(month)).length,
    retentionDays: retentionDays(),
  };
}

export interface AuditView { admin: PlatformAdmin; rows: (PlatformAuditRow & { tenantName: string })[] }

export async function loadAuditLog(now = new Date()): Promise<AuditView> {
  const admin = await requirePlatformAdmin();
  const [{ rows }, log] = await Promise.all([
    allTenantRows(now), getData().platform.audit({ prefixes: ["platform.", "demo.", "privacy."], limit: 200 }),
  ]);
  const name = new Map(rows.map((r) => [r.id, r.name]));
  // "platform.view" (one row per admin per hour) is noise here.
  return { admin, rows: log.filter((r) => r.action !== "platform.view").map((r) => ({ ...r, tenantName: r.tenantId ? name.get(r.tenantId) ?? "—" : "—" })) };
}

// ---------------------------------------------------------------- actions (admin only, audited)

export const SUSPEND_REASONS = ["payment", "abuse", "customer_request", "other"] as const;
export const CHANGE_REASONS = ["upgrade", "downgrade", "courtesy", "season", "support", "other"] as const;
export type ActionResult = { ok: true; tenant?: TenantInfo } | { ok: false; error: "not_found" | "invalid" | "confirm" | "rate_limited" | "legal_hold" | "not_demo" | "failed" };

const ACTIONS_PER_HOUR = 60;
async function guard(): Promise<PlatformAdmin | null> {
  const admin = await requirePlatformAdmin();
  const r = await hit(hashKey("platform-action", admin.userId), ACTIONS_PER_HOUR, 60 * 60 * 1000, Date.now()).catch(() => ({ ok: false }));
  return r.ok ? admin : null;
}
const isOne = <T extends string>(list: readonly T[], v: unknown): v is T => (list as readonly string[]).includes(String(v));

async function update(tenantId: string, patch: Parameters<ReturnType<typeof getData>["platform"]["updateTenant"]>[1], admin: PlatformAdmin, action: string, detail: string): Promise<ActionResult> {
  try {
    const tenant = await getData().platform.updateTenant(tenantId, patch);
    if (!tenant) return { ok: false, error: "not_found" };
    await getData().audit.log(tenant.id, admin.userId, action, detail).catch(() => undefined);
    return { ok: true, tenant };
  } catch (e) {
    return { ok: false, error: e instanceof DataValidationError ? "invalid" : "failed" };
  }
}

/** Suspends a business: the typed short address must match (guards against suspending the wrong one). */
export async function suspendTenant(tenantId: string, reason: string, confirmSlug: string): Promise<ActionResult> {
  const admin = await guard();
  if (!admin) return { ok: false, error: "rate_limited" };
  if (!isOne(SUSPEND_REASONS, reason)) return { ok: false, error: "invalid" };
  const t = await getData().tenants.get(tenantId).catch(() => null);
  if (!t || t.status === "deleted") return { ok: false, error: "not_found" };
  if (confirmSlug.trim().toLowerCase() !== t.slug.toLowerCase()) return { ok: false, error: "confirm" };
  return update(t.id, { status: "suspended" }, admin, "platform.tenant.suspended", reason);
}

export async function reactivateTenant(tenantId: string): Promise<ActionResult> {
  const admin = await guard();
  if (!admin) return { ok: false, error: "rate_limited" };
  return update(tenantId, { status: "active" }, admin, "platform.tenant.reactivated", "");
}

export async function changePlan(tenantId: string, plan: string, reason: string): Promise<ActionResult> {
  const admin = await guard();
  if (!admin) return { ok: false, error: "rate_limited" };
  if (!isOne(["free", "pro", "business"] as const, plan) || !isOne(CHANGE_REASONS, reason)) return { ok: false, error: "invalid" };
  const before = await getData().tenants.get(tenantId).catch(() => null);
  if (!before) return { ok: false, error: "not_found" };
  return update(before.id, { plan: plan as TenantPlan }, admin, "platform.tenant.plan", `${before.plan}>${plan} ${reason}`);
}

export async function setAiCap(tenantId: string, cap: number, reason: string): Promise<ActionResult> {
  const admin = await guard();
  if (!admin) return { ok: false, error: "rate_limited" };
  if (!Number.isInteger(cap) || cap < 0 || !isOne(CHANGE_REASONS, reason)) return { ok: false, error: "invalid" };
  const before = await getData().tenants.get(tenantId).catch(() => null);
  if (!before) return { ok: false, error: "not_found" };
  return update(before.id, { aiMonthlyTokenCap: cap }, admin, "platform.tenant.ai_cap", `${before.aiMonthlyTokenCap}>${cap} ${reason}`);
}

/** Only demo businesses, and never one holding a real conversation under legal hold (demo/business.ts). */
export async function deleteDemoTenant(tenantId: string, confirmSlug: string): Promise<ActionResult> {
  const admin = await guard();
  if (!admin) return { ok: false, error: "rate_limited" };
  const t = await getData().tenants.get(tenantId).catch(() => null);
  if (!t) return { ok: false, error: "not_found" };
  if (confirmSlug.trim().toLowerCase() !== t.slug.toLowerCase()) return { ok: false, error: "confirm" };
  const r = await deleteDemoBusiness(t.id, admin.userId);
  return r.ok ? { ok: true } : { ok: false, error: r.error };
}

export async function liftLegalHold(tenantId: string, conversationId: string, reason: string): Promise<ActionResult> {
  const admin = await guard();
  if (!admin) return { ok: false, error: "rate_limited" };
  if (!isOne(LEGAL_HOLD_LIFT_REASONS, reason)) return { ok: false, error: "invalid" };
  try {
    return (await getData().platform.liftLegalHold(tenantId, conversationId, admin.userId, reason)) ? { ok: true } : { ok: false, error: "not_found" };
  } catch {
    return { ok: false, error: "failed" };
  }
}
