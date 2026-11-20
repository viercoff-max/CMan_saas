import { z } from "zod";
import { withSession, json } from "@/lib/channels/api";
import { getData } from "@/lib/data";
import { withPreviews } from "@/lib/channels/repo";
import { loadInboxCounts } from "@/app/(app)/inbox/counts";
import { isDemoConversation, isUrgent } from "@/app/(app)/inbox/kinds";

const Query = z.object({
  channel: z.enum(["telegram", "whatsapp", "instagram", "messenger", "simulator"]).optional(),
  status: z.enum(["bot", "needs_human", "human", "resolved"]).optional(),
  q: z.string().max(100).optional(),
});

export async function GET(req: Request) {
  return withSession(async (s) => {
    const sp = new URL(req.url).searchParams;
    const parsed = Query.safeParse({
      channel: sp.get("channel") || undefined, status: sp.get("status") || undefined, q: sp.get("q") || undefined,
    });
    if (!parsed.success) return json({ error: "invalid_query" }, 400);
    const { channel, status, q } = parsed.data;
    // Simulator (test) conversations only show when explicitly filtered; they never count as real customers.
    const data = getData();
    const [rows, { counts, urgent }] = await Promise.all([
      data.conversations.list(s.tenantId, { channel, status, search: q?.trim() || undefined, limit: 200 }),
      loadInboxCounts(s.tenantId), // same loader as the dashboard and the sidebar badge
    ]);
    const convs = rows.filter((c) => channel === "simulator" || c.channel !== "simulator");
    const items = (await withPreviews(s.tenantId, convs)).map((c) => ({ ...c, urgent: isUrgent(c), demo: isDemoConversation(c) }));
    return json({ conversations: items, counts, urgent });
  });
}
