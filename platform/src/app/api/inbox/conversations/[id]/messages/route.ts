import { withSession, json } from "@/lib/channels/api";
import { getData } from "@/lib/data";
import { isWindowExpired } from "@/lib/channels/repo";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withSession(async (s) => {
    const data = getData();
    const conv = await data.conversations.get(s.tenantId, id);
    if (!conv) return json({ error: "not_found" }, 404);
    if (conv.unread > 0) await data.conversations.markRead(s.tenantId, id);
    const lastIn = await data.messages.lastInboundAt(s.tenantId, id);
    return json({
      conversation: { ...conv, unread: 0 },
      messages: await data.messages.list(s.tenantId, id),
      lastInboundAt: lastIn,
      windowExpired: isWindowExpired(conv.channel, lastIn),
    });
  });
}
