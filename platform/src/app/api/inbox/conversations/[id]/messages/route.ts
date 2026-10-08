import { withSession, json } from "@/lib/channels/api";
import { getConversation, listMessages, markConversationRead } from "@/lib/store";
import { isWindowExpired, lastInboundAt } from "@/lib/channels/repo";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withSession((s) => {
    const conv = getConversation(s.tenantId, id);
    if (!conv) return json({ error: "not_found" }, 404);
    if (conv.unread > 0) markConversationRead(s.tenantId, id);
    const lastIn = lastInboundAt(s.tenantId, id);
    return json({
      conversation: { ...conv, unread: 0 },
      messages: listMessages(s.tenantId, id),
      lastInboundAt: lastIn,
      windowExpired: isWindowExpired(conv.channel, lastIn),
    });
  });
}
