// Platform console (SQLite). CROSS-TENANT by design: only lib/platform/* calls it, after
// platformAdmins.isPlatformAdmin(userId). Same results as the Supabase RPCs (20261123100000_platform_console.sql).
import { aiDayKey, AI_DAY_UNIT_TOKENS, assertLiftReason, auditArgs, normalizeTenantPatch, statsDays, utcDays } from "../platform-rules";
import { AUDIT_GLOBAL_TENANT, type PlatformRepo, type TenantInfo, type TenantPlan, type TenantStatus } from "../types";
import { newId } from "../../ids";
import { db, json, tx, type Row } from "./conn";
import { sqliteIso } from "./people";

const n = (v: unknown) => Number(v ?? 0) || 0;
const URGENT = "('safety', 'legal')";

export const platform: PlatformRepo = {
  async stats(q = {}) {
    const now = q.now ?? new Date();
    const days = utcDays(now, statsDays(q.days));
    const t = q.tenantId ?? null;
    const d = db();
    const tn = d.prepare(`SELECT COUNT(*) total,
        SUM(status = 'active') active, SUM(status = 'suspended') suspended, SUM(status = 'deleted') deleted,
        SUM(plan = 'free') free, SUM(plan = 'pro') pro, SUM(plan = 'business') business
      FROM tenants WHERE (? IS NULL OR id = ?)`).get(t, t) as Row;
    const perDay = new Map((d.prepare(`SELECT substr(created_at, 1, 10) day, COUNT(*) n FROM conversations
        WHERE (? IS NULL OR tenant_id = ?) AND channel <> 'simulator' AND substr(created_at, 1, 10) >= ? GROUP BY 1`)
      .all(t, t, days[0]) as Row[]).map((r) => [String(r.day), n(r.n)]));
    const w = d.prepare(`SELECT COUNT(*) total,
        SUM(escalation_reason IN ${URGENT}) urgent,
        COUNT(DISTINCT CASE WHEN escalation_reason IN ${URGENT} THEN tenant_id END) urgent_tenants,
        MIN(CASE WHEN escalation_reason IN ${URGENT} THEN last_message_at END) oldest
      FROM conversations WHERE (? IS NULL OR tenant_id = ?) AND status = 'needs_human' AND channel <> 'simulator'`).get(t, t) as Row;
    const channels = (d.prepare(`SELECT channel, status, COUNT(*) n FROM channel_accounts WHERE (? IS NULL OR tenant_id = ?)
        GROUP BY channel, status ORDER BY channel, status`).all(t, t) as Row[])
      .map((r) => ({ channel: String(r.channel), status: String(r.status), count: n(r.n) }));
    const channelErrors = (d.prepare(`SELECT tenant_id, channel FROM channel_accounts WHERE status = 'error' AND (? IS NULL OR tenant_id = ?)
        ORDER BY tenant_id, channel LIMIT 100`).all(t, t) as Row[]).map((r) => ({ tenantId: String(r.tenant_id), channel: String(r.channel) }));
    const period = `${now.toISOString().slice(0, 7)}-01`;
    const ai = d.prepare("SELECT COALESCE(SUM(input_tokens), 0) i, COALESCE(SUM(output_tokens), 0) o FROM ai_usage WHERE period = ? AND (? IS NULL OR tenant_id = ?)").get(period, t, t) as Row;
    const lh = d.prepare("SELECT COUNT(*) total, COUNT(DISTINCT tenant_id) tenants FROM conversations WHERE legal_hold = 1 AND (? IS NULL OR tenant_id = ?)").get(t, t) as Row;
    const activity = (d.prepare(`SELECT tenant_id, MAX(last_message_at) last_at FROM conversations
        WHERE (? IS NULL OR tenant_id = ?) AND channel <> 'simulator' GROUP BY tenant_id`).all(t, t) as Row[])
      .map((r) => ({ tenantId: String(r.tenant_id), lastMessageAt: sqliteIso(r.last_at) }));
    return {
      tenants: { total: n(tn.total), active: n(tn.active), suspended: n(tn.suspended), deleted: n(tn.deleted), free: n(tn.free), pro: n(tn.pro), business: n(tn.business) },
      byDay: days.map((day) => ({ day, count: perDay.get(day) ?? 0 })),
      waiting: n(w.total), urgent: n(w.urgent), urgentTenants: n(w.urgent_tenants), oldestUrgentAt: w.oldest ? sqliteIso(w.oldest) : null,
      channels, channelErrors, aiInputTokens: n(ai.i), aiOutputTokens: n(ai.o), legalHolds: n(lh.total), legalHoldTenants: n(lh.tenants), activity,
    };
  },
  async demoTenantIds() {
    return (db().prepare("SELECT DISTINCT tenant_id FROM audit_log WHERE action = 'demo.business' LIMIT 1000").all() as Row[]).map((r) => String(r.tenant_id));
  },
  async updateTenant(tenantId, patch) {
    const p = normalizeTenantPatch(patch);
    const sets: string[] = [], args: (string | number)[] = [];
    if (p.status) { sets.push("status = ?"); args.push(p.status); }
    if (p.plan) { sets.push("plan = ?"); args.push(p.plan); }
    if (p.aiMonthlyTokenCap !== undefined) { sets.push("ai_monthly_token_cap = ?"); args.push(p.aiMonthlyTokenCap); }
    const d = db();
    const changed = d.prepare(`UPDATE tenants SET ${sets.join(", ")} WHERE id = ? AND COALESCE(status, 'active') <> 'deleted'`).run(...args, tenantId).changes;
    if (!changed) return null;
    const r = d.prepare("SELECT id, name, slug, plan, status, ai_monthly_token_cap, created_at FROM tenants WHERE id = ?").get(tenantId) as Row;
    return {
      id: String(r.id), name: String(r.name ?? ""), slug: String(r.slug || r.id), plan: String(r.plan) as TenantPlan,
      status: String(r.status) as TenantStatus, aiMonthlyTokenCap: n(r.ai_monthly_token_cap), createdAt: sqliteIso(r.created_at),
    } satisfies TenantInfo;
  },
  async legalHolds(q = {}) {
    const t = q.tenantId ?? null;
    return (db().prepare(`SELECT id, tenant_id, channel, escalation_reason, created_at FROM conversations
        WHERE legal_hold = 1 AND (? IS NULL OR tenant_id = ?) ORDER BY created_at, id LIMIT 200`).all(t, t) as Row[])
      .map((r) => ({
        tenantId: String(r.tenant_id), conversationId: String(r.id), channel: String(r.channel ?? ""),
        reason: r.escalation_reason == null ? null : String(r.escalation_reason), createdAt: sqliteIso(r.created_at),
      }));
  },
  async liftLegalHold(tenantId, conversationId, actor, reason) {
    assertLiftReason(reason);
    const d = db();
    return tx(d, () => {
      const row = d.prepare("SELECT state FROM conversations WHERE tenant_id = ? AND id = ? AND legal_hold = 1").get(tenantId, conversationId) as Row | undefined;
      if (!row) return false;
      const state = json(row.state);
      delete state.legalHold;
      d.prepare(`UPDATE conversations SET legal_hold = 0, state = ?,
          escalation_reason = CASE WHEN escalation_reason IN ${URGENT} THEN NULL ELSE escalation_reason END
        WHERE tenant_id = ? AND id = ?`).run(JSON.stringify(state), tenantId, conversationId);
      d.prepare("INSERT INTO audit_log (id, tenant_id, actor, action, detail) VALUES (?,?,?,?,?)")
        .run(newId(), tenantId, actor.slice(0, 80), "platform.legal_hold.lifted", `${conversationId} ${reason}`);
      return true;
    });
  },
  async audit(q) {
    const { prefixes, limit } = auditArgs(q);
    const like = prefixes.map(() => "action LIKE ? ESCAPE '\\'").join(" OR ");
    const args: string[] = prefixes.map((p) => `${p.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    let where = `(${like})`;
    if (q.tenantId !== undefined) { where += " AND tenant_id = ?"; args.push(q.tenantId); }
    return (db().prepare(`SELECT tenant_id, actor, action, detail, created_at FROM audit_log WHERE ${where}
        ORDER BY created_at DESC, rowid DESC LIMIT ${limit}`).all(...args) as Row[])
      .map((r) => ({
        tenantId: r.tenant_id === AUDIT_GLOBAL_TENANT ? null : String(r.tenant_id), actor: String(r.actor ?? ""),
        action: String(r.action ?? ""), detail: String(r.detail ?? ""), createdAt: sqliteIso(r.created_at),
      }));
  },
  async aiReservedToday(now = new Date()) {
    const r = db().prepare("SELECT count FROM rate_limits WHERE key = ?").get(aiDayKey(now)) as Row | undefined;
    return r ? n(r.count) * AI_DAY_UNIT_TOKENS : 0;
  },
};
