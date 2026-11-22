import { withSession, json } from "@/lib/channels/api";
import { getData } from "@/lib/data";
import { isWindowExpired } from "@/lib/channels/repo";
import { teamDirectory } from "@/lib/inbox/team";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withSession(async (s) => {
    const data = getData();
    const conv = await data.conversations.get(s.tenantId, id);
    if (!conv) return json({ error: "not_found" }, 404);
    if (conv.unread > 0) await data.conversations.markRead(s.tenantId, id);
    const [lastIn, messages, notes, events, team, customer] = await Promise.all([
      data.messages.lastInboundAt(s.tenantId, id),
      data.messages.list(s.tenantId, id),
      data.notes.list(s.tenantId, id),
      data.events.list(s.tenantId, id),
      teamDirectory(s.tenantId),
      conv.customerId ? data.customers.get(s.tenantId, conv.customerId) : Promise.resolve(null),
    ]);
    return json({
      conversation: { ...conv, unread: 0 },
      messages, notes, events, team, me: s.userId,
      customer: customer ? { id: customer.id, name: customer.name, tags: customer.tags } : null,
      lastInboundAt: lastIn,
      windowExpired: isWindowExpired(conv.channel, lastIn),
    });
  });
}
