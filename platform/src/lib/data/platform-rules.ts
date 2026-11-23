// Validation shared by both PlatformRepo backends (pure; relative type-only imports for the CLI scripts).
import { DataValidationError } from "./errors";
import { LEGAL_HOLD_LIFT_REASONS, PLATFORM_AUDIT_PREFIXES, type PlatformAuditQuery, type PlatformStats, type PlatformTenantPatch } from "./types";

export const MAX_AI_CAP = 1_000_000_000;

export function statsDays(days: number | undefined): number {
  const n = Math.floor(Number(days ?? 30));
  return Number.isFinite(n) ? Math.min(90, Math.max(1, n)) : 30;
}

/** UTC days ending on `now`'s day, oldest first ("YYYY-MM-DD"). */
export function utcDays(now: Date, days: number): string[] {
  const end = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Array.from({ length: days }, (_, i) => new Date(end - (days - 1 - i) * 86_400_000).toISOString().slice(0, 10));
}

/** Only status active/suspended, a known plan and a whole-number cap 0..1e9; at least one field. */
export function normalizeTenantPatch(p: PlatformTenantPatch): PlatformTenantPatch {
  const out: PlatformTenantPatch = {};
  if (p.status !== undefined) {
    if (p.status !== "active" && p.status !== "suspended") throw new DataValidationError("status");
    out.status = p.status;
  }
  if (p.plan !== undefined) {
    if (!["free", "pro", "business"].includes(p.plan)) throw new DataValidationError("plan");
    out.plan = p.plan;
  }
  if (p.aiMonthlyTokenCap !== undefined) {
    const n = p.aiMonthlyTokenCap;
    if (!Number.isInteger(n) || n < 0 || n > MAX_AI_CAP) throw new DataValidationError("aiMonthlyTokenCap");
    out.aiMonthlyTokenCap = n;
  }
  if (!Object.keys(out).length) throw new DataValidationError("patch");
  return out;
}

export function assertLiftReason(reason: string): void {
  if (!(LEGAL_HOLD_LIFT_REASONS as readonly string[]).includes(reason)) throw new DataValidationError("reason");
}

export function auditArgs(q: PlatformAuditQuery): { prefixes: string[]; limit: number } {
  const prefixes = [...new Set(q.prefixes)];
  if (!prefixes.length || prefixes.length > 5 || !prefixes.every((p) => PLATFORM_AUDIT_PREFIXES.test(p))) throw new DataValidationError("prefixes");
  const limit = Math.min(200, Math.max(1, Math.floor(Number(q.limit ?? 50)) || 50));
  return { prefixes, limit };
}

export const emptyPlatformStats = (): PlatformStats => ({
  tenants: { total: 0, active: 0, suspended: 0, deleted: 0, free: 0, pro: 0, business: 0 },
  byDay: [], waiting: 0, urgent: 0, urgentTenants: 0, oldestUrgentAt: null, channels: [], channelErrors: [],
  aiInputTokens: 0, aiOutputTokens: 0, legalHolds: 0, legalHoldTenants: 0, activity: [],
});

/** Key of engine/spend.ts's shared day counter (units of SPEND_UNIT_TOKENS). */
export const aiDayKey = (now: Date) => `engine-ai-day:${now.toISOString().slice(0, 10)}`;
export const AI_DAY_UNIT_TOKENS = 1_000;
