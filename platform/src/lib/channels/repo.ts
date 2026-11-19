// Inbox helpers on top of the data layer (tenant scoped). No SQL here: storage is src/lib/data.
import { getData } from "../data";
import type { Channel, Conversation } from "../types";

export interface ConversationListItem extends Conversation { preview: string; previewSender: string }

export async function withPreviews(tenantId: string, convs: Conversation[]): Promise<ConversationListItem[]> {
  const latest = await getData().messages.latest(tenantId, convs.map((c) => c.id));
  return convs.map((c) => {
    const r = latest.get(c.id);
    return { ...c, preview: String(r?.body ?? "").slice(0, 120), previewSender: String(r?.sender ?? "") };
  });
}

const WINDOW_MS = 24 * 60 * 60 * 1000;
export function isWindowExpired(channel: Channel, lastInbound: string | null, now = Date.now()): boolean {
  if (channel === "simulator") return false;
  if (!lastInbound) return true;
  return now - new Date(lastInbound).getTime() > WINDOW_MS;
}

export async function deleteSimulatorConversation(tenantId: string, externalId: string): Promise<void> {
  const data = getData();
  const id = await data.conversations.findIdByExternal(tenantId, "simulator", externalId);
  if (id) await data.conversations.delete(tenantId, id);
}
