// Per-tenant AI metering and monthly cap (tokens = input + output, tenants.aiMonthlyTokenCap, see data/types.ts UsageRepo).
// - Before an LLM call: readBudget() -> usage.remaining(tenantId); the engine then reserves the call's upper-bound
//   estimate against it and against the platform daily cap (spend.ts). Errors fail CLOSED (the engine then answers
//   with the free deterministic fallback, so the customer still gets a reply).
// - After an LLM call: recordUsage() -> usage.record(tenantId, {requests: 1, inputTokens, outputTokens}). Best effort:
//   a metering failure is logged (error class only) and never breaks the reply.
// - Cap reached: noteCapReached() writes ONE audit event per tenant per UTC day ("ai.cap_reached", detail "day=YYYY-MM-DD").
// Simulator conversations are metered too: they call the same paid model.
import { auditEvent } from "../audit-events";
import { getData } from "../data";
import { OFFLINE_MODEL, totalInputTokens, type LLMResult } from "./llm";

export const AI_CAP_AUDIT_ACTION = "ai.cap_reached";
/** Stored in conversations.escalation_reason (max 40 chars). */
export const AI_CAP_REASON = "ai_cap_reached";
const AUDIT_ACTOR = "engine";

/** The storage the engine needs; defaults to getData().usage / audit. Injectable for tests. */
export interface UsageMeter {
  remaining(tenantId: string, now: Date): Promise<number>;
  record(tenantId: string, v: { requests: number; inputTokens: number; outputTokens: number }, at: Date): Promise<void>;
  /** True when an "ai.cap_reached" audit row already exists for this tenant and detail. */
  auditExists(tenantId: string, detail: string): Promise<boolean>;
  audit(tenantId: string, detail: string): Promise<void>;
}

export const dataUsageMeter: UsageMeter = {
  remaining: (t, now) => getData().usage.remaining(t, now),
  record: async (t, v, at) => { await getData().usage.record(t, v, at); },
  auditExists: async (t, detail) => (await getData().audit.find(t, { action: AI_CAP_AUDIT_ACTION, detail })) !== null,
  audit: (t, detail) => auditEvent(t, AUDIT_ACTOR, AI_CAP_AUDIT_ACTION, detail),
};

const errName = (e: unknown) => (e instanceof Error ? e.name : "error");

/** Tokens the tenant has left this month. Fails closed (remaining 0, error) when the budget cannot be read. */
export async function readBudget(meter: UsageMeter, tenantId: string, now: Date): Promise<{ remaining: number; error?: boolean }> {
  try {
    return { remaining: Math.max(0, Number(await meter.remaining(tenantId, now)) || 0) };
  } catch (e) {
    console.error("[engine] usage.remaining failed:", errName(e));
    return { remaining: 0, error: true };
  }
}

/** true when the tenant has tokens left this month. Fails closed (false) when the budget cannot be read. */
export async function hasBudget(meter: UsageMeter, tenantId: string, now: Date): Promise<{ ok: boolean; error?: boolean }> {
  const b = await readBudget(meter, tenantId, now);
  return b.error ? { ok: false, error: true } : { ok: b.remaining > 0 };
}

// Platform breaker: one log line per UTC day per process (no tenant data in it).
let platformCapLoggedFor = "";
export function notePlatformCapReached(now: Date): void {
  const day = now.toISOString().slice(0, 10);
  if (platformCapLoggedFor === day) return;
  platformCapLoggedFor = day;
  console.warn(`[engine] platform daily AI token cap reached (day=${day}): paid LLM calls paused until 00:00 UTC`);
}

/** Meter one LLM call for THIS tenant. The offline fallback costs nothing and is not metered. Never throws. */
export async function recordUsage(meter: UsageMeter, tenantId: string, r: LLMResult, at: Date): Promise<void> {
  if (r.model === OFFLINE_MODEL) return;
  try {
    await meter.record(tenantId, { requests: 1, inputTokens: totalInputTokens(r.usage), outputTokens: r.usage.outputTokens || 0 }, at);
  } catch (e) {
    console.error("[engine] usage.record failed:", errName(e));
  }
}

// In-process dedupe in front of the audit lookup (the audit row itself dedupes across instances).
const notedToday = new Set<string>();

/** One "ai.cap_reached" audit event per tenant per UTC day. Never throws. */
export async function noteCapReached(meter: UsageMeter, tenantId: string, now: Date): Promise<void> {
  const detail = `day=${now.toISOString().slice(0, 10)}`;
  const key = `${tenantId}\u0000${detail}`;
  if (notedToday.has(key)) return;
  try {
    if (!(await meter.auditExists(tenantId, detail))) await meter.audit(tenantId, detail);
    if (notedToday.size > 10_000) notedToday.clear();
    notedToday.add(key);
  } catch (e) {
    console.error("[engine] cap audit failed:", errName(e));
  }
}
