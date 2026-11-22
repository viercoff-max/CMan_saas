// Team inbox actions shared by the inbox routes (server only): assignment, status changes and the activity log.
// The caller passes the SESSION; tenant comes from it, never from the request. Every change writes an event.
import { getData } from "../data";
import type { Session } from "../auth";
import type { Conversation, ConversationStatus } from "../types";

/** Members of the active tenant (id + display name) for the assign menu. */
export async function teamDirectory(tenantId: string): Promise<{ userId: string; name: string; role: string }[]> {
  return (await getData().members.list(tenantId)).map((m) => ({ userId: m.userId, name: m.name || m.email || "—", role: m.role }));
}

export type AssignResult = { ok: true; assignedTo: string | null } | { ok: false; error: "not_member" | "not_found" };

/** Assign to a member of THIS tenant (null = unassign). A non-member id is refused (cross-tenant negative). */
export async function assignConversation(s: Pick<Session, "tenantId" | "userId">, conv: Conversation, userId: string | null): Promise<AssignResult> {
  const data = getData();
  if (userId !== null && !(await data.members.list(s.tenantId)).some((m) => m.userId === userId)) return { ok: false, error: "not_member" };
  if ((conv.assignedTo ?? null) === userId) return { ok: true, assignedTo: userId };
  if (!(await data.conversations.assign(s.tenantId, conv.id, userId))) return { ok: false, error: "not_found" };
  await data.events.add(s.tenantId, conv.id, {
    actorUserId: s.userId, kind: userId ? "assigned" : "unassigned", detail: userId ? { to: userId, from: conv.assignedTo ?? null } : { from: conv.assignedTo ?? null },
  });
  await data.audit.log(s.tenantId, s.userId, userId ? "inbox.assign" : "inbox.unassign", conv.id);
  return { ok: true, assignedTo: userId };
}

/** Status change + event. Back to the bot or resolved: clears the engine's per-episode counters. */
export async function changeStatus(s: Pick<Session, "tenantId" | "userId">, conv: Conversation, status: ConversationStatus): Promise<void> {
  const data = getData();
  if (conv.status === status) return;
  await data.conversations.setStatus(s.tenantId, conv.id, status);
  if (status === "bot" || status === "resolved") await data.conversations.resetForBot(s.tenantId, conv.id);
  await data.events.add(s.tenantId, conv.id, { actorUserId: s.userId, kind: "status", detail: { from: conv.status, to: status } });
  await data.audit.log(s.tenantId, s.userId, "inbox.status", `${conv.id}:${status}`);
}
