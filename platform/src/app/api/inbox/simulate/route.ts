import { z } from "zod";
import { withSession, json } from "@/lib/channels/api";
import { checkSameOrigin } from "@/lib/security/origin";
import { getOrCreateConversation, listMessages, markConversationRead } from "@/lib/store";
import { handleInbound } from "@/lib/engine";
import { deleteSimulatorConversation } from "@/lib/channels/repo";

const Body = z.object({ text: z.string().trim().min(1).max(2000) });
const simId = (userId: string) => `sim-${userId}`;

/** GET: current simulator conversation (if any). */
export async function GET() {
  return withSession((s) => {
    const conv = getOrCreateConversation(s.tenantId, "simulator", simId(s.userId), "Simulador");
    markConversationRead(s.tenantId, conv.id);
    return json({ conversation: conv, messages: listMessages(s.tenantId, conv.id) });
  });
}

/** POST: the owner writes as a customer; the engine answers. */
export async function POST(req: Request) {
  const bad = checkSameOrigin(req); if (bad) return bad;
  return withSession(async (s) => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: "invalid_body" }, 400);
    const reply = await handleInbound({
      tenantId: s.tenantId, channel: "simulator", externalId: simId(s.userId), customerName: "Simulador", text: parsed.data.text,
    });
    const conv = getOrCreateConversation(s.tenantId, "simulator", simId(s.userId), "Simulador");
    markConversationRead(s.tenantId, conv.id);
    return json({ reply, conversation: conv, messages: listMessages(s.tenantId, conv.id) });
  });
}

/** DELETE: restart the simulated conversation. */
export async function DELETE(req: Request) {
  const bad = checkSameOrigin(req); if (bad) return bad;
  return withSession((s) => {
    deleteSimulatorConversation(s.tenantId, simId(s.userId));
    return json({ ok: true });
  });
}
