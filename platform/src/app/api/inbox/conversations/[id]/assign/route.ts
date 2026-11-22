// Assign a conversation: { userId: "<member id>" | "me" | null }. Any team member may assign; the assignee must be a
// member of the SAME tenant (checked here and, in Supabase, by a database trigger).
import { z } from "zod";
import { withSession, json } from "@/lib/channels/api";
import { checkSameOrigin } from "@/lib/security/origin";
import { getData } from "@/lib/data";
import { assignConversation } from "@/lib/inbox/team";

const Body = z.object({ userId: z.union([z.literal("me"), z.string().min(1).max(64), z.null()]) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const bad = checkSameOrigin(req); if (bad) return bad;
  const { id } = await ctx.params;
  return withSession(async (s) => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: "invalid_body" }, 400);
    const conv = await getData().conversations.get(s.tenantId, id);
    if (!conv) return json({ error: "not_found" }, 404);
    const target = parsed.data.userId === "me" ? s.userId : parsed.data.userId;
    const r = await assignConversation(s, conv, target);
    if (!r.ok) return json({ error: r.error }, r.error === "not_member" ? 400 : 404);
    return json({ ok: true, assignedTo: r.assignedTo });
  });
}
