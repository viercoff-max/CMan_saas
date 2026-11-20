// Handoff notification. Writes an email-style text file to the outbox (lib/storage/outbox.ts): DATA_DIR/outbox/ in
// SQLite mode, "<tenantId>/outbox/" in the private tenant-files bucket in Supabase mode. Retention purges both.
// TODO(production): send through SMTP / Resend to settings.handoffEmail instead of (or in addition to) the outbox file.
import { getData } from "../data";
import { maskEmailsInText } from "../engine/text";
import { writeOutboxFile } from "../storage/outbox";

const URGENT = new Set(["safety", "legal"]);
const SENDER_LABEL = { customer: "Cliente", bot: "Asistente", agent: "Equipo" } as const;

export function buildHandoffText(p: {
  to: string; reason: string; customerName: string; channel: string; link: string;
  messages: { sender: keyof typeof SENDER_LABEL; body: string; createdAt: string }[];
}): { subject: string; text: string } {
  const urgent = URGENT.has(p.reason);
  const who = p.customerName || "(sin nombre)";
  const subject = `${urgent ? "[URGENTE] " : ""}Un cliente necesita a una persona (${p.channel}) - ${who}`;
  const lines = [
    `To: ${p.to || "(sin correo configurado)"}`,
    `Subject: ${subject}`,
    "",
    `Motivo: ${p.reason}`,
    `Cliente: ${who}`,
    `Canal: ${p.channel}`,
    `Abrir conversación: ${p.link}`,
    "",
    "Últimos mensajes:",
    // PII: customer emails are masked (j***@gmail.com) in outbox files.
    ...p.messages.map((m) => `[${m.createdAt}] ${SENDER_LABEL[m.sender]}: ${maskEmailsInText(m.body).replace(/\s+/g, " ").trim()}`),
    "",
  ];
  return { subject, text: lines.join("\n") };
}

export async function notifyHandoff(tenantId: string, conversationId: string, reason: string): Promise<void> {
  try {
    const data = getData();
    const conv = await data.conversations.get(tenantId, conversationId);
    if (!conv) return;
    // The simulator is the owner testing the bot: keep the status change (done by the engine) but never alert the team.
    if (conv.channel === "simulator") return;
    const settings = await data.settings.get(tenantId);
    const base = (process.env.PUBLIC_URL || "http://localhost:3000").replace(/\/$/, "");
    const msgs = (await data.messages.list(tenantId, conversationId, 500)).slice(-10);
    const { text } = buildHandoffText({
      to: settings.handoffEmail, reason, customerName: conv.customerName, channel: conv.channel,
      link: `${base}/inbox?c=${conv.id}`, messages: msgs,
    });
    const file = await writeOutboxFile(tenantId, conv.id, text);
    console.info(`[handoff] outbox file written: ${file} reason=${reason} channel=${conv.channel}`);
  } catch {
    console.error("[handoff] could not write outbox file");
  }
}
