// Pure conversation classification shared by the inbox list/route, the dashboard, the sidebar badge and billing.
// One source of truth so every screen counts "waiting" and "urgent" the same way (REVIEW-qa-2 P1-6, P2-1).
import { emptyStatusCounts, type Conversation, type ConversationStatus } from "@/lib/types";

/** External-id prefix written by the local demo seed (`src/lib/demo/content.ts` DEMO_PREFIX). */
export const DEMO_EXTERNAL_PREFIX = "demo-";

/** Seeded demo conversation: it has no real customer behind it, so a reply is stored but never sent anywhere. */
export function isDemoConversation(c: Pick<Conversation, "externalId" | "state">): boolean {
  return (typeof c.externalId === "string" && c.externalId.startsWith(DEMO_EXTERNAL_PREFIX)) || c.state?.demo === true;
}

/** Escalation reasons that mean "a person must look at this first" (safety and legal cases). */
export const URGENT_REASONS = ["safety", "legal"] as const;

export function isUrgent(c: Pick<Conversation, "status" | "escalationReason">): boolean {
  return c.status === "needs_human" && (URGENT_REASONS as readonly string[]).includes(c.escalationReason ?? "");
}

/** Every escalation reason the engine can set (docs/REQUESTS.md). Unknown reasons are shown without a label. */
export const ESCALATION_REASONS = ["safety", "legal", "human_request", "no_answer", "attempts", "bot_disabled", "ai_cap_reached"] as const;
export const isKnownReason = (r: string | null | undefined): r is (typeof ESCALATION_REASONS)[number] =>
  !!r && (ESCALATION_REASONS as readonly string[]).includes(r);

/** Inbox order: urgent first, then the rest of "needs a person", then everything else; newest first inside each. */
export function inboxRank(c: Pick<Conversation, "status" | "escalationReason">): number {
  return isUrgent(c) ? 0 : c.status === "needs_human" ? 1 : 2;
}
export function sortForInbox<T extends Pick<Conversation, "status" | "escalationReason" | "lastMessageAt">>(items: T[]): T[] {
  return [...items].sort((a, b) => inboxRank(a) - inboxRank(b) || b.lastMessageAt.localeCompare(a.lastMessageAt));
}

export interface InboxCounts { counts: Record<ConversationStatus, number>; urgent: number }

/** Counts for real-customer conversations (the simulator never counts). */
export function summarize(rows: Pick<Conversation, "channel" | "status" | "escalationReason">[]): InboxCounts {
  const counts: Record<ConversationStatus, number> = emptyStatusCounts();
  let urgent = 0;
  for (const c of rows) {
    if (c.channel === "simulator") continue;
    counts[c.status] += 1;
    if (isUrgent(c)) urgent += 1;
  }
  return { counts, urgent };
}
