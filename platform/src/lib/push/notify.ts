// Who gets which notice (server only). Called after a handoff (engine) and after an assignment (inbox).
// The notice text never contains the customer's name or message (it can show on a locked screen): only the kind,
// the channel and the business name. Never throws (notices are best effort).
import { getData } from "../data";
import { sendPush } from "./webpush";

const CHANNEL: Record<string, string> = { telegram: "Telegram", whatsapp: "WhatsApp", instagram: "Instagram", messenger: "Messenger", manychat: "ManyChat", simulator: "Simulador" };

async function deliver(tenantId: string, userIds: string[], n: { kind: "waiting" | "urgent" | "assigned" | "test"; title: string; body: string; url: string }) {
  const data = getData();
  if (!userIds.length) return 0;
  for (const u of userIds) await data.push.addNotice(tenantId, u, n);
  const devices = await data.push.devicesFor(tenantId, userIds);
  let sent = 0;
  await Promise.all(devices.map(async (d) => {
    const r = await sendPush(d.endpoint, { urgent: n.kind === "urgent" });
    if (r === "gone" || r === "blocked") await data.push.removeEndpoint(d.endpoint).catch(() => undefined);
    if (r === "ok") sent++;
  }));
  return sent;
}

/** A conversation needs a person: notify every member who wants it (urgent = safety / legal). */
export async function notifyHandoff(tenantId: string, conversationId: string, channel: string, reason: string): Promise<void> {
  try {
    if (channel === "simulator") return; // tests never ping the team
    const data = getData();
    const urgent = reason === "safety" || reason === "legal";
    const members = await data.members.list(tenantId);
    const wanted: string[] = [];
    for (const m of members) {
      const p = await data.push.getPrefs(tenantId, m.userId);
      if (urgent ? p.urgent : p.waiting) wanted.push(m.userId);
    }
    const tenant = await data.tenants.get(tenantId);
    await deliver(tenantId, wanted, {
      kind: urgent ? "urgent" : "waiting",
      title: urgent ? "Caso urgente: un cliente necesita a una persona" : "Un cliente necesita a una persona",
      body: `${tenant?.name ?? ""} · ${CHANNEL[channel] ?? channel}${urgent ? (reason === "safety" ? " · Seguridad" : " · Legal") : ""}`.replace(/^ · /, ""),
      url: `/inbox?c=${conversationId}`,
    });
  } catch { console.error("[push] handoff notice failed"); }
}

/** A conversation was assigned to someone else: tell them (if they want it). */
export async function notifyAssigned(tenantId: string, conversationId: string, assigneeId: string, actorId: string): Promise<void> {
  try {
    if (assigneeId === actorId) return;
    const data = getData();
    if (!(await data.push.getPrefs(tenantId, assigneeId)).assigned) return;
    const tenant = await data.tenants.get(tenantId);
    await deliver(tenantId, [assigneeId], { kind: "assigned", title: "Te asignaron una conversación", body: tenant?.name ?? "", url: `/inbox?c=${conversationId}` });
  } catch { console.error("[push] assigned notice failed"); }
}

/** "Enviar prueba" from the Notificaciones screen: only the person's own devices in this business. */
export async function notifyTest(tenantId: string, userId: string): Promise<number> {
  return deliver(tenantId, [userId], { kind: "test", title: "Avisos activados", body: "Así te llegarán los avisos de Conversa.", url: "/notifications" });
}
