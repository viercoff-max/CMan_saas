// Audit log, AI usage, engine limiter and login/rate-limit counters (SQLite).
import { newId, nowIso } from "../../ids";
import { nonNeg, tokensRemaining, usagePeriod } from "../rules";
import type { AuditQuery, AuditRepo, LimiterRepo, RateLimitsRepo, UsageRepo, UsageRow } from "../types";
import { db, type Row } from "./conn";

function auditWhere(tenantId: string, q: AuditQuery = {}): { sql: string; args: string[] } {
  const where = ["tenant_id = ?"]; const args = [tenantId];
  if (q.actor !== undefined) { where.push("actor = ?"); args.push(q.actor); }
  if (q.action !== undefined) { where.push("action = ?"); args.push(q.action); }
  if (q.detail !== undefined) { where.push("detail = ?"); args.push(q.detail); }
  return { sql: where.join(" AND "), args };
}

export const audit: AuditRepo = {
  async log(tenantId, actor, action, detail = "") {
    db().prepare("INSERT INTO audit_log (id, tenant_id, actor, action, detail) VALUES (?,?,?,?,?)").run(newId(), tenantId, actor, action, detail);
  },
  async find(tenantId, q) {
    const w = auditWhere(tenantId, q);
    const r = db().prepare(`SELECT detail FROM audit_log WHERE ${w.sql} LIMIT 1`).get(...w.args) as Row | undefined;
    return r ? String(r.detail ?? "") : null;
  },
  async list(tenantId, q) {
    const w = auditWhere(tenantId, q);
    return (db().prepare(`SELECT actor, action, detail, created_at FROM audit_log WHERE ${w.sql} ORDER BY created_at, rowid`).all(...w.args) as Row[])
      .map((r) => ({ actor: r.actor as string, action: r.action as string, detail: String(r.detail ?? ""), createdAt: r.created_at as string }));
  },
  async deleteByActor(tenantId, actor) {
    return Number(db().prepare("DELETE FROM audit_log WHERE tenant_id=? AND actor=?").run(tenantId, actor).changes);
  },
};


function readUsage(tenantId: string, period: string): UsageRow {
  const r = db().prepare("SELECT requests, input_tokens, output_tokens FROM ai_usage WHERE tenant_id=? AND period=?").get(tenantId, period) as Row | undefined;
  return { tenantId, period, requests: Number(r?.requests ?? 0), inputTokens: Number(r?.input_tokens ?? 0), outputTokens: Number(r?.output_tokens ?? 0) };
}

export const usage: UsageRepo = {
  async record(tenantId, v, at = new Date()) {
    const period = usagePeriod(at);
    db().prepare(
      `INSERT INTO ai_usage (tenant_id, period, requests, input_tokens, output_tokens, updated_at) VALUES (?,?,?,?,?,?)
       ON CONFLICT(tenant_id, period) DO UPDATE SET requests = requests + excluded.requests,
         input_tokens = input_tokens + excluded.input_tokens, output_tokens = output_tokens + excluded.output_tokens,
         updated_at = excluded.updated_at`
    ).run(tenantId, period, nonNeg(v.requests ?? 1), nonNeg(v.inputTokens), nonNeg(v.outputTokens), nowIso());
    return readUsage(tenantId, period);
  },
  async get(tenantId, period = usagePeriod()) { return readUsage(tenantId, period); },
  async remaining(tenantId, now = new Date()) {
    const t = db().prepare("SELECT ai_monthly_token_cap FROM tenants WHERE id = ?").get(tenantId) as Row | undefined;
    if (!t) return 0; // unknown tenant: no budget (fail closed)
    const u = readUsage(tenantId, usagePeriod(now));
    return tokensRemaining(t.ai_monthly_token_cap, u.inputTokens, u.outputTokens);
  },
};

const count = (sql: string, ...args: (string | number)[]) =>
  Number((db().prepare(sql).get(...args) as { n: number } | undefined)?.n ?? 0);

export const limiter: LimiterRepo = {
  async countLookupFailures(tenantId, since, by = {}) {
    if (by.orderHash) return count("SELECT COUNT(*) AS n FROM engine_lookup_failures WHERE tenant_id=? AND order_hash=? AND at>?", tenantId, by.orderHash, since);
    if (by.emailHash) return count("SELECT COUNT(*) AS n FROM engine_lookup_failures WHERE tenant_id=? AND email_hash=? AND at>?", tenantId, by.emailHash, since);
    return count("SELECT COUNT(*) AS n FROM engine_lookup_failures WHERE tenant_id=? AND at>?", tenantId, since);
  },
  async recordLookupFailure(tenantId, orderHash, emailHash, at, pruneBefore) {
    const d = db();
    d.prepare("INSERT INTO engine_lookup_failures (tenant_id, order_hash, email_hash, at) VALUES (?,?,?,?)").run(tenantId, orderHash, emailHash, at);
    d.prepare("DELETE FROM engine_lookup_failures WHERE tenant_id=? AND at<?").run(tenantId, pruneBefore);
  },
  async recordInbound(tenantId, conversationId, at, pruneBefore, since) {
    const d = db();
    d.prepare("INSERT INTO engine_inbound_log (tenant_id, conversation_id, at) VALUES (?,?,?)").run(tenantId, conversationId, at);
    d.prepare("DELETE FROM engine_inbound_log WHERE tenant_id=? AND conversation_id=? AND at<?").run(tenantId, conversationId, pruneBefore);
    return count("SELECT COUNT(*) AS n FROM engine_inbound_log WHERE tenant_id=? AND conversation_id=? AND at>?", tenantId, conversationId, since);
  },
};

export const rateLimits: RateLimitsRepo = {
  async hit(key, limit, windowMs, now) {
    const d = db();
    const row = d.prepare("SELECT window_start, count FROM rate_limits WHERE key = ?").get(key) as
      | { window_start: number; count: number } | undefined;
    if (!row || now - row.window_start >= windowMs) {
      d.prepare("INSERT INTO rate_limits (key, window_start, count) VALUES (?,?,1) ON CONFLICT(key) DO UPDATE SET window_start=excluded.window_start, count=1")
        .run(key, now);
      return { ok: true, retryAfterS: 0 };
    }
    d.prepare("UPDATE rate_limits SET count = count + 1 WHERE key = ?").run(key);
    const ok = row.count + 1 <= limit;
    return { ok, retryAfterS: ok ? 0 : Math.ceil((row.window_start + windowMs - now) / 1000) };
  },
  async recordLoginFailure(keys, now) {
    const ins = db().prepare("INSERT INTO login_attempts (key, at) VALUES (?, ?)");
    for (const k of keys) ins.run(k, now);
  },
  async countLoginFailures(key, since) {
    return count("SELECT COUNT(*) AS n FROM login_attempts WHERE key = ? AND at > ?", key, since);
  },
  async clearLoginFailures(key) {
    db().prepare("DELETE FROM login_attempts WHERE key = ?").run(key);
  },
  async purge(before) {
    const d = db();
    const a = Number(d.prepare("DELETE FROM login_attempts WHERE at < ?").run(before).changes);
    const b = Number(d.prepare("DELETE FROM rate_limits WHERE window_start < ?").run(before).changes);
    return a + b;
  },
};
