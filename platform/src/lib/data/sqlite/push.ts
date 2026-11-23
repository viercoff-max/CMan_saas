// Phase 2 notifications (SQLite). Same rules as the Supabase backend.
import { newId, nowIso } from "../../ids";
import type { NoticeKind, NoticeRow, PushRepo, PushSubscriptionRow } from "../types";
import { db, type Row } from "./conn";

const mapSub = (r: Row): PushSubscriptionRow => ({
  id: r.id as string, tenantId: r.tenant_id as string, userId: r.user_id as string, endpoint: r.endpoint as string,
  userAgent: String(r.user_agent ?? ""), createdAt: String(r.created_at ?? ""),
});

export const push: PushRepo = {
  async getPrefs(tenantId, userId) {
    const r = db().prepare("SELECT waiting, urgent, assigned FROM notification_prefs WHERE tenant_id=? AND user_id=?").get(tenantId, userId) as Row | undefined;
    return r ? { waiting: Number(r.waiting) === 1, urgent: Number(r.urgent) === 1, assigned: Number(r.assigned) === 1 } : { waiting: true, urgent: true, assigned: true };
  },
  async savePrefs(tenantId, userId, p) {
    db().prepare(`INSERT INTO notification_prefs (tenant_id, user_id, waiting, urgent, assigned, updated_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(tenant_id, user_id) DO UPDATE SET waiting=excluded.waiting, urgent=excluded.urgent, assigned=excluded.assigned, updated_at=excluded.updated_at`)
      .run(tenantId, userId, p.waiting ? 1 : 0, p.urgent ? 1 : 0, p.assigned ? 1 : 0, nowIso());
  },
  async subscribe(tenantId, userId, endpoint, userAgent) {
    db().prepare(`INSERT INTO push_subscriptions (id, tenant_id, user_id, endpoint, user_agent, created_at) VALUES (?,?,?,?,?,?)
      ON CONFLICT(endpoint) DO UPDATE SET tenant_id=excluded.tenant_id, user_id=excluded.user_id, user_agent=excluded.user_agent`)
      .run(newId(), tenantId, userId, endpoint, userAgent.slice(0, 200), nowIso());
  },
  async unsubscribe(tenantId, userId, endpoint) {
    return Number(db().prepare("DELETE FROM push_subscriptions WHERE tenant_id=? AND user_id=? AND endpoint=?").run(tenantId, userId, endpoint).changes) === 1;
  },
  async listDevices(tenantId, userId) {
    return (db().prepare("SELECT * FROM push_subscriptions WHERE tenant_id=? AND user_id=? ORDER BY created_at").all(tenantId, userId) as Row[]).map(mapSub);
  },
  async devicesFor(tenantId, userIds) {
    if (!userIds.length) return [];
    return (db().prepare(`SELECT * FROM push_subscriptions WHERE tenant_id=? AND user_id IN (${userIds.map(() => "?").join(",")})`).all(tenantId, ...userIds) as Row[]).map(mapSub);
  },
  async removeEndpoint(endpoint) { db().prepare("DELETE FROM push_subscriptions WHERE endpoint=?").run(endpoint); },
  async addNotice(tenantId, userId, n) {
    db().prepare("INSERT INTO notifications (id, tenant_id, user_id, kind, title, body, url, created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(newId(), tenantId, userId, n.kind, n.title.slice(0, 120), n.body.slice(0, 240), n.url, nowIso());
  },
  async latestNotices(userId, sinceIso, limit = 5) {
    return (db().prepare("SELECT * FROM notifications WHERE user_id=? AND created_at >= ? ORDER BY created_at DESC, rowid DESC LIMIT ?").all(userId, sinceIso, limit) as Row[])
      .map((r): NoticeRow => ({ id: r.id as string, tenantId: r.tenant_id as string, userId: r.user_id as string, kind: r.kind as NoticeKind, title: String(r.title), body: String(r.body), url: String(r.url), createdAt: String(r.created_at) }));
  },
  async purgeNotices(tenantId, beforeIso) {
    return Number(db().prepare("DELETE FROM notifications WHERE tenant_id=? AND created_at < ?").run(tenantId, beforeIso).changes);
  },
};
