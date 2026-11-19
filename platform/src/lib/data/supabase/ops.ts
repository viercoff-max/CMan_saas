// Audit log, AI usage, engine limiter and login/rate-limit counters (Supabase).
// The limiter API speaks epoch ms; engine_lookup_failures.at / engine_inbound_log.at / login_attempts.at are
// timestamptz (converted with msToIso). rate_limits.window_start is a bigint of epoch ms (as in SQLite).
// Counters that must be atomic use RPCs (usage_add, rate_limit_hit: migration 20261120100000_server_rpc_counters).
import { nonNeg, usagePeriod } from "../rules";
import type { AuditQuery, AuditRepo, LimiterRepo, RateLimitsRepo, UsageRepo } from "../types";
import { scoped, type Db, type Query, type Scoped } from "./client";
import { allRows, cap, count, isoOr, mapUsage, msToIso, obj, one, rows, run } from "./map";

function auditFilter(q: Query, f: AuditQuery = {}): Query {
  if (f.actor !== undefined) q = q.eq("actor", f.actor);
  if (f.action !== undefined) q = q.eq("action", f.action);
  if (f.detail !== undefined) q = q.eq("detail", f.detail);
  return q;
}

export function auditRepo(db: Db): AuditRepo {
  return {
    async log(tenantId, actor, action, detail = "") {
      // Lengths capped to the CHECK constraints: an audit row must never make the business action fail.
      await run(scoped(db, tenantId).from("audit_log").insert({ actor: cap(actor, 80), action: cap(action, 80), detail: cap(detail, 500) }), "audit.log");
    },
    async find(tenantId, q) {
      const rs = await rows(auditFilter(scoped(db, tenantId).from("audit_log").select("detail"), q).order("created_at").limit(1), "audit.find");
      return rs.length ? String(rs[0].detail ?? "") : null;
    },
    async list(tenantId, q) {
      const s = scoped(db, tenantId);
      return (await allRows(() => auditFilter(s.from("audit_log").select("actor, action, detail, created_at"), q).order("created_at").order("id"), "audit.list"))
        .map((r) => ({ actor: String(r.actor ?? ""), action: String(r.action ?? ""), detail: String(r.detail ?? ""), createdAt: isoOr(r.created_at) }));
    },
    async deleteByActor(tenantId, actor) {
      return count(scoped(db, tenantId).from("audit_log").delete({ count: "exact" }).eq("actor", actor), "audit.deleteByActor");
    },
  };
}

const readUsage = async (s: Scoped, period: string) =>
  mapUsage(s.tenantId, period, await one(s.from("ai_usage").select("requests, input_tokens, output_tokens").eq("period", period).maybeSingle(), "usage.get"));

export function usageRepo(db: Db): UsageRepo {
  return {
    async record(tenantId, v, at = new Date()) {
      const s = scoped(db, tenantId);
      const period = usagePeriod(at);
      const r = obj((await run(s.rpc("usage_add", {
        p_period: period, p_requests: nonNeg(v.requests ?? 1), p_input_tokens: nonNeg(v.inputTokens), p_output_tokens: nonNeg(v.outputTokens),
      }), "usage.record")).data);
      return mapUsage(s.tenantId, period, r);
    },
    async get(tenantId, period = usagePeriod()) { return readUsage(scoped(db, tenantId), period); },
  };
}

export function limiterRepo(db: Db): LimiterRepo {
  return {
    async countLookupFailures(tenantId, since, by = {}) {
      let q = scoped(db, tenantId).from("engine_lookup_failures").select("id", { count: "exact", head: true });
      if (by.orderHash) q = q.eq("order_hash", by.orderHash);
      else if (by.emailHash) q = q.eq("email_hash", by.emailHash);
      return count(q.gt("at", msToIso(since)), "limiter.countLookupFailures");
    },
    async recordLookupFailure(tenantId, orderHash, emailHash, at, pruneBefore) {
      const s = scoped(db, tenantId);
      await run(s.from("engine_lookup_failures").insert({ order_hash: orderHash, email_hash: emailHash, at: msToIso(at) }), "limiter.recordLookupFailure");
      await run(s.from("engine_lookup_failures").delete().lt("at", msToIso(pruneBefore)), "limiter.recordLookupFailure");
    },
    async recordInbound(tenantId, conversationId, at, pruneBefore, since) {
      const s = scoped(db, tenantId);
      await run(s.from("engine_inbound_log").insert({ conversation_id: conversationId, at: msToIso(at) }), "limiter.recordInbound");
      await run(s.from("engine_inbound_log").delete().eq("conversation_id", conversationId).lt("at", msToIso(pruneBefore)), "limiter.recordInbound");
      return count(s.from("engine_inbound_log").select("id", { count: "exact", head: true }).eq("conversation_id", conversationId).gt("at", msToIso(since)), "limiter.recordInbound");
    },
  };
}

/** Global counters (not tenant-owned): keys are HMAC hashes, never raw emails / IPs. */
export function rateLimitsRepo(db: Db): RateLimitsRepo {
  return {
    async hit(key, limit, windowMs, now) {
      const r = obj((await run(db.rpc("rate_limit_hit", { p_key: key, p_limit: limit, p_window_ms: windowMs, p_now: now }), "rateLimits.hit")).data);
      return { ok: r.ok === true, retryAfterS: Number(r.retryAfterS ?? 0) };
    },
    async recordLoginFailure(keys, now) {
      if (!keys.length) return;
      await run(db.from("login_attempts").insert(keys.map((key) => ({ key, at: msToIso(now) }))), "rateLimits.recordLoginFailure");
    },
    async countLoginFailures(key, since) {
      return count(db.from("login_attempts").select("id", { count: "exact", head: true }).eq("key", key).gt("at", msToIso(since)), "rateLimits.countLoginFailures");
    },
    async clearLoginFailures(key) {
      await run(db.from("login_attempts").delete().eq("key", key), "rateLimits.clearLoginFailures");
    },
    async purge(before) {
      const a = await count(db.from("login_attempts").delete({ count: "exact" }).lt("at", msToIso(before)), "rateLimits.purge");
      const b = await count(db.from("rate_limits").delete({ count: "exact" }).lt("window_start", before), "rateLimits.purge");
      return a + b;
    },
  };
}
