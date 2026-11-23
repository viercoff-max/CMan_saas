// Platform console (Supabase). CROSS-TENANT by design: only lib/platform/* calls it, after
// platformAdmins.isPlatformAdmin(userId). Counts come from one RPC (migration 20261123100000_platform_console.sql,
// service_role only); the legal-hold lift is an RPC too (atomic with its audit row).
import { aiDayKey, AI_DAY_UNIT_TOKENS, assertLiftReason, auditArgs, emptyPlatformStats, normalizeTenantPatch, statsDays } from "../platform-rules";
import type { PlatformRepo, PlatformStats } from "../types";
import { isUuid, type Db } from "./client";
import { escapeLike, isoOr, mapTenant, obj, one, rows, run, TENANT_COLUMNS } from "./map";

const num = (v: unknown) => Number(v ?? 0) || 0;
const list = (v: unknown): Record<string, unknown>[] => (Array.isArray(v) ? (v as Record<string, unknown>[]) : []);

export function mapPlatformStats(raw: unknown): PlatformStats {
  const r = obj(raw);
  const t = obj(r.tenants), w = obj(r.waiting), ai = obj(r.ai), lh = obj(r.legal_holds);
  return {
    ...emptyPlatformStats(),
    tenants: { total: num(t.total), active: num(t.active), suspended: num(t.suspended), deleted: num(t.deleted), free: num(t.free), pro: num(t.pro), business: num(t.business) },
    byDay: list(r.by_day).map((d) => ({ day: String(d.day ?? ""), count: num(d.count) })),
    waiting: num(w.total), urgent: num(w.urgent), urgentTenants: num(w.urgent_tenants),
    oldestUrgentAt: w.oldest_urgent_at ? isoOr(w.oldest_urgent_at) : null,
    channels: list(r.channels).map((c) => ({ channel: String(c.channel ?? ""), status: String(c.status ?? ""), count: num(c.count) })),
    channelErrors: list(r.channel_errors).map((c) => ({ tenantId: String(c.tenant_id ?? ""), channel: String(c.channel ?? "") })),
    aiInputTokens: num(ai.input), aiOutputTokens: num(ai.output),
    legalHolds: num(lh.total), legalHoldTenants: num(lh.tenants),
    activity: list(r.activity).map((a) => ({ tenantId: String(a.tenant_id ?? ""), lastMessageAt: isoOr(a.last_message_at) })),
  };
}

export function platformRepo(db: Db): PlatformRepo {
  return {
    async stats(q = {}) {
      if (q.tenantId !== undefined && !isUuid(q.tenantId)) return emptyPlatformStats();
      const res = await run(db.rpc("platform_stats", {
        p_now: (q.now ?? new Date()).toISOString(), p_days: statsDays(q.days), p_tenant: q.tenantId ?? null,
      }), "platform.stats");
      return mapPlatformStats(res.data);
    },
    async demoTenantIds() {
      const rs = await rows(db.from("audit_log").select("tenant_id").eq("action", "demo.business").limit(1000), "platform.demoTenantIds");
      return [...new Set(rs.map((r) => r.tenant_id).filter((v): v is string => typeof v === "string"))];
    },
    async updateTenant(tenantId, patch) {
      if (!isUuid(tenantId)) return null;
      const p = normalizeTenantPatch(patch);
      const row: Record<string, unknown> = {};
      if (p.status) row.status = p.status;
      if (p.plan) row.plan = p.plan;
      if (p.aiMonthlyTokenCap !== undefined) row.ai_monthly_token_cap = p.aiMonthlyTokenCap;
      // Never touches a deleted tenant.
      const rs = await rows(db.from("tenants").update(row).eq("id", tenantId).neq("status", "deleted").select(TENANT_COLUMNS), "platform.updateTenant");
      return rs.length ? mapTenant(rs[0]) : null;
    },
    async legalHolds(q = {}) {
      if (q.tenantId !== undefined && !isUuid(q.tenantId)) return [];
      let query = db.from("conversations").select("id, tenant_id, channel, escalation_reason, created_at").eq("legal_hold", true);
      if (q.tenantId) query = query.eq("tenant_id", q.tenantId);
      const rs = await rows(query.order("created_at").limit(200), "platform.legalHolds");
      return rs.map((r) => ({
        tenantId: String(r.tenant_id), conversationId: String(r.id), channel: String(r.channel ?? ""),
        reason: r.escalation_reason == null ? null : String(r.escalation_reason), createdAt: isoOr(r.created_at),
      }));
    },
    async liftLegalHold(tenantId, conversationId, actor, reason) {
      assertLiftReason(reason);
      if (!isUuid(tenantId) || !isUuid(conversationId)) return false;
      const res = await run(db.rpc("platform_lift_legal_hold", {
        p_tenant: tenantId, p_conversation: conversationId, p_actor: actor, p_reason: reason,
      }), "platform.liftLegalHold");
      return res.data === true;
    },
    async audit(q) {
      const { prefixes, limit } = auditArgs(q);
      if (q.tenantId !== undefined && !isUuid(q.tenantId)) return [];
      const all = (await Promise.all(prefixes.map((p) => {
        let query = db.from("audit_log").select("tenant_id, actor, action, detail, created_at").like("action", `${escapeLike(p)}%`);
        if (q.tenantId) query = query.eq("tenant_id", q.tenantId);
        return rows(query.order("created_at", { ascending: false }).limit(limit), "platform.audit");
      }))).flat();
      return all
        .map((r) => ({
          tenantId: typeof r.tenant_id === "string" ? r.tenant_id : null, actor: String(r.actor ?? ""), action: String(r.action ?? ""),
          detail: String(r.detail ?? ""), createdAt: isoOr(r.created_at),
        }))
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0))
        .slice(0, limit);
    },
    async aiReservedToday(now = new Date()) {
      const r = await one(db.from("rate_limits").select("count").eq("key", aiDayKey(now)).maybeSingle(), "platform.aiReservedToday");
      return r ? num(r.count) * AI_DAY_UNIT_TOKENS : 0;
    },
  };
}
