// Phase 2 notifications (Supabase, service role). Tenant-owned queries go through scoped(); the two documented
// cross-tenant helpers (removeEndpoint, latestNotices) filter by endpoint / user id instead.
import type { NoticeKind, NoticeRow, PushRepo, PushSubscriptionRow } from "../types";
import { isUuid, scoped, type Db, type Row } from "./client";
import { cap, isoOr, one, rows, run } from "./map";

const SUB_COLS = "id, tenant_id, user_id, endpoint, user_agent, created_at";
const mapSub = (r: Row): PushSubscriptionRow => ({
  id: r.id as string, tenantId: r.tenant_id as string, userId: r.user_id as string, endpoint: String(r.endpoint),
  userAgent: String(r.user_agent ?? ""), createdAt: isoOr(r.created_at),
});

export function pushRepo(db: Db): PushRepo {
  return {
    async getPrefs(tenantId, userId) {
      if (!isUuid(userId)) return { waiting: true, urgent: true, assigned: true };
      const r = await one(scoped(db, tenantId).from("notification_prefs").select("waiting, urgent, assigned").eq("user_id", userId).maybeSingle(), "push.getPrefs");
      return r ? { waiting: r.waiting !== false, urgent: r.urgent !== false, assigned: r.assigned !== false } : { waiting: true, urgent: true, assigned: true };
    },
    async savePrefs(tenantId, userId, p) {
      if (!isUuid(userId)) return;
      await run(scoped(db, tenantId).from("notification_prefs").upsert({ user_id: userId, waiting: !!p.waiting, urgent: !!p.urgent, assigned: !!p.assigned, updated_at: new Date().toISOString() }, { onConflict: "tenant_id,user_id" }), "push.savePrefs");
    },
    async subscribe(tenantId, userId, endpoint, userAgent) {
      if (!isUuid(userId)) return;
      // A device moves to whoever turns notices on in it last (endpoint is unique).
      await run(db.from("push_subscriptions").delete().eq("endpoint", endpoint), "push.subscribe");
      await run(scoped(db, tenantId).from("push_subscriptions").insert({ user_id: userId, endpoint, user_agent: cap(userAgent, 200) }), "push.subscribe");
    },
    async unsubscribe(tenantId, userId, endpoint) {
      if (!isUuid(userId)) return false;
      return (await rows(scoped(db, tenantId).from("push_subscriptions").delete().eq("user_id", userId).eq("endpoint", endpoint).select("id"), "push.unsubscribe")).length === 1;
    },
    async listDevices(tenantId, userId) {
      if (!isUuid(userId)) return [];
      return (await rows(scoped(db, tenantId).from("push_subscriptions").select(SUB_COLS).eq("user_id", userId).order("created_at"), "push.listDevices")).map(mapSub);
    },
    async devicesFor(tenantId, userIds) {
      const ids = userIds.filter(isUuid);
      if (!ids.length) return [];
      return (await rows(scoped(db, tenantId).from("push_subscriptions").select(SUB_COLS).in("user_id", ids), "push.devicesFor")).map(mapSub);
    },
    async removeEndpoint(endpoint) { await run(db.from("push_subscriptions").delete().eq("endpoint", endpoint), "push.removeEndpoint"); },
    async addNotice(tenantId, userId, n) {
      if (!isUuid(userId)) return;
      await run(scoped(db, tenantId).from("notifications").insert({ user_id: userId, kind: n.kind, title: cap(n.title, 120), body: cap(n.body, 240), url: n.url }), "push.addNotice");
    },
    async latestNotices(userId, sinceIso, limit = 5) {
      if (!isUuid(userId)) return [];
      return (await rows(db.from("notifications").select("id, tenant_id, user_id, kind, title, body, url, created_at").eq("user_id", userId).gte("created_at", sinceIso).order("created_at", { ascending: false }).limit(limit), "push.latestNotices"))
        .map((r): NoticeRow => ({ id: r.id as string, tenantId: r.tenant_id as string, userId: r.user_id as string, kind: r.kind as NoticeKind, title: String(r.title), body: String(r.body), url: String(r.url), createdAt: isoOr(r.created_at) }));
    },
    async purgeNotices(tenantId, beforeIso) {
      return (await rows(scoped(db, tenantId).from("notifications").delete().lt("created_at", beforeIso).select("id"), "push.purgeNotices")).length;
    },
  };
}
