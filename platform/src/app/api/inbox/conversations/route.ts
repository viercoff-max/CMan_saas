import { z } from "zod";
import { withSession, json } from "@/lib/channels/api";
import { listConversations } from "@/lib/store";
import { withPreviews } from "@/lib/channels/repo";
import type { ConversationStatus } from "@/lib/types";

const Query = z.object({
  channel: z.enum(["whatsapp", "instagram", "messenger", "simulator"]).optional(),
  status: z.enum(["bot", "needs_human", "human", "resolved"]).optional(),
  q: z.string().max(100).optional(),
});

export async function GET(req: Request) {
  return withSession((s) => {
    const sp = new URL(req.url).searchParams;
    const parsed = Query.safeParse({
      channel: sp.get("channel") || undefined, status: sp.get("status") || undefined, q: sp.get("q") || undefined,
    });
    if (!parsed.success) return json({ error: "invalid_query" }, 400);
    const { channel, status, q } = parsed.data;
    // Simulator (test) conversations only show when explicitly filtered; they never count as real customers.
    const convs = listConversations(s.tenantId, { channel, status, search: q?.trim() || undefined, limit: 200 })
      .filter((c) => channel === "simulator" || c.channel !== "simulator");
    const counts: Record<ConversationStatus, number> = { bot: 0, needs_human: 0, human: 0, resolved: 0 };
    for (const c of listConversations(s.tenantId, { limit: 5000 })) if (c.channel !== "simulator") counts[c.status] += 1;
    return json({ conversations: withPreviews(s.tenantId, convs), counts });
  });
}
