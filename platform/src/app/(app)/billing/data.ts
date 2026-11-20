// Server-side loader for "Plan y uso" and the dashboard AI KPI. Every read is scoped to the ACTIVE tenant.
import { getData } from "@/lib/data";
import type { TenantPlan } from "@/lib/data/types";
import { countConversationsThisMonth, renewalDate, usageMeter, type UsageMeter } from "./usage";

/** Conversations are counted from the newest rows; more than this shows as "N+" (see docs/REQUESTS.md). */
export const CONVERSATION_SCAN_LIMIT = 1000;

export interface UsageSummary {
  plan: TenantPlan;
  ai: UsageMeter;
  renewsAt: Date;
  conversations: number;
  conversationsCapped: boolean;
}

export async function loadAiUsage(tenantId: string, now: Date = new Date()): Promise<{ plan: TenantPlan; ai: UsageMeter; renewsAt: Date }> {
  const data = getData();
  const [tenant, usage] = await Promise.all([data.tenants.get(tenantId), data.usage.get(tenantId)]);
  // Unknown tenant: fail closed (cap 0), like usage.remaining.
  return { plan: tenant?.plan ?? "free", ai: usageMeter(tenant?.aiMonthlyTokenCap ?? 0, usage.inputTokens, usage.outputTokens), renewsAt: renewalDate(now) };
}

export async function loadUsageSummary(tenantId: string, now: Date = new Date()): Promise<UsageSummary> {
  const [ai, rows] = await Promise.all([
    loadAiUsage(tenantId, now),
    getData().conversations.list(tenantId, { limit: CONVERSATION_SCAN_LIMIT }),
  ]);
  return { ...ai, conversations: countConversationsThisMonth(rows, now), conversationsCapped: rows.length >= CONVERSATION_SCAN_LIMIT };
}
