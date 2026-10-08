import { z } from "zod";
import { withSession, json } from "@/lib/channels/api";
import { checkSameOrigin } from "@/lib/security/origin";
import { addMessage, audit, getConversation, setConversationStatus } from "@/lib/store";
import { sendToCustomer } from "@/lib/channels/send";

const Body = z.object({ text: z.string().trim().min(1).max(4000) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const bad = checkSameOrigin(req); if (bad) return bad;
  const { id } = await ctx.params;
  return withSession(async (s) => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: "invalid_body" }, 400);
    const conv = getConversation(s.tenantId, id);
    if (!conv) return json({ error: "not_found" }, 404);

    const sent = await sendToCustomer(s.tenantId, conv, parsed.data.text);
    if (!sent.ok) return json({ error: "send_failed", detail: sent.error ?? "" }, 502);

    const message = addMessage(s.tenantId, id, { direction: "out", sender: "agent", body: parsed.data.text, meta: { agentUserId: s.userId } });
    // A person is answering: the bot must stop.
    if (conv.status !== "human") setConversationStatus(s.tenantId, id, "human");
    audit(s.tenantId, s.userId, "inbox.reply", id);
    return json({ ok: true, message });
  });
}
