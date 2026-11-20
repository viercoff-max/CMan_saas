// Server-side "who is waiting" counts. The inbox banner, the inbox API, the dashboard KPI and the sidebar badge all read
// THIS loader, so they can never disagree (REVIEW-qa-2 P2-1). Tenant-scoped; the simulator is excluded by
// conversations.countByStatus (both backends) and by `summarize`.
import { getData } from "@/lib/data";
import { isUrgent, type InboxCounts } from "./kinds";

/** Upper bound for the urgent scan (only conversations currently waiting for a person are read). */
export const URGENT_SCAN_LIMIT = 1000;

export async function loadInboxCounts(tenantId: string): Promise<InboxCounts> {
  const data = getData();
  const [counts, waiting] = await Promise.all([
    data.conversations.countByStatus(tenantId),
    data.conversations.list(tenantId, { status: "needs_human", limit: URGENT_SCAN_LIMIT }),
  ]);
  const urgent = waiting.filter((c) => c.channel !== "simulator" && isUrgent(c)).length;
  return { counts, urgent };
}
