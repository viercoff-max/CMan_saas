// Server-side loader for the dashboard metrics of the ACTIVE tenant (every read is tenant scoped).
import { getData } from "../data";
import { isOpenNow, parseBusinessHours } from "../engine/escalate";
import { loadInboxCounts } from "@/app/(app)/inbox/counts";
import { teamDirectory } from "../inbox/team";
import { computeMetrics, periodStart, type Metrics, type Period } from "./dashboard";

const CONV_SCAN = 1000;
const MSG_SCAN = 20_000;

export async function loadMetrics(tenantId: string, period: Period, now: Date = new Date()): Promise<Metrics & { since: Date; timeZone: string; capped: boolean }> {
  const data = getData();
  const settings = await data.settings.get(tenantId);
  const bh = parseBusinessHours(settings.businessHours);
  const timeZone = bh.timezone || "America/Mexico_City";
  const since = periodStart(period, now, timeZone);
  const sinceIso = since.toISOString();
  const [conversations, messages, events, counts, team] = await Promise.all([
    data.conversations.list(tenantId, { limit: CONV_SCAN }),
    data.messages.listSince(tenantId, sinceIso, MSG_SCAN),
    data.events.listSince(tenantId, sinceIso, MSG_SCAN),
    loadInboxCounts(tenantId),
    teamDirectory(tenantId),
  ]);
  const returningCustomerIds = new Set(conversations.filter((c) => c.customerId && c.createdAt < sinceIso).map((c) => c.customerId!));
  const m = computeMetrics({
    now, since, timeZone, conversations, messages, events, returningCustomerIds,
    isOpen: bh.configured ? (d) => isOpenNow(bh, d) : undefined,
    waiting: counts.counts.needs_human, urgent: counts.urgent,
    team: team.map((t) => ({ userId: t.userId, name: t.name })),
  });
  return { ...m, since, timeZone, capped: messages.length >= MSG_SCAN || conversations.length >= CONV_SCAN };
}
