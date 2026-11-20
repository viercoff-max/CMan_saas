import { z } from "zod";
import { withSession, json } from "@/lib/channels/api";
import { checkSameOrigin } from "@/lib/security/origin";
import { getData } from "@/lib/data";
import { sendToCustomer } from "@/lib/channels/send";
import { isDemoConversation } from "@/app/(app)/inbox/kinds";
import { sendFailureStatus } from "@/app/(app)/inbox/send-errors";

const Body = z.object({ text: z.string().trim().min(1).max(4000) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const bad = checkSameOrigin(req); if (bad) return bad;
  const { id } = await ctx.params;
  return withSession(async (s) => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: "invalid_body" }, 400);
    const data = getData();
    const conv = await data.conversations.get(s.tenantId, id);
    if (!conv) return json({ error: "not_found" }, 404);

    // Seeded demo conversations have no real customer: store the reply so the takeover flow can be shown, never send.
    const demo = isDemoConversation(conv);
    if (!demo) {
      const sent = await sendToCustomer(s.tenantId, conv, parsed.data.text);
      if (!sent.ok) {
        const detail = sent.error ?? "";
        return json({ error: "send_failed", detail }, sendFailureStatus(detail));
      }
    }

    const message = await data.messages.add(s.tenantId, id, {
      direction: "out", sender: "agent", body: parsed.data.text,
      meta: { agentUserId: s.userId, ...(demo ? { demo: true, notSent: true } : {}) },
    });
    // A person is answering: the bot must stop.
    if (conv.status !== "human") await data.conversations.setStatus(s.tenantId, id, "human");
    await data.audit.log(s.tenantId, s.userId, demo ? "inbox.reply_demo" : "inbox.reply", id);
    return json({ ok: true, message, demo });
  });
}
