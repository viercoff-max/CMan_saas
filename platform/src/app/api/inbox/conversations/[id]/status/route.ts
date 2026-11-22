import { z } from "zod";
import { withSession, json } from "@/lib/channels/api";
import { checkSameOrigin } from "@/lib/security/origin";
import { getData } from "@/lib/data";
import { changeStatus } from "@/lib/inbox/team";
import type { ConversationStatus } from "@/lib/types";

// take = a person handles it now; pending = follow up later; waiting = waiting for the customer's answer.
const ACTIONS = ["take", "pending", "waiting", "return", "resolve"] as const;
const Body = z.object({ action: z.enum(ACTIONS) });
const MAP: Record<(typeof ACTIONS)[number], ConversationStatus> = {
  take: "human", pending: "pending", waiting: "waiting_customer", return: "bot", resolve: "resolved",
};

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const bad = checkSameOrigin(req); if (bad) return bad;
  const { id } = await ctx.params;
  return withSession(async (s) => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: "invalid_body" }, 400);
    const conv = await getData().conversations.get(s.tenantId, id);
    if (!conv) return json({ error: "not_found" }, 404);
    const status = MAP[parsed.data.action];
    await changeStatus(s, conv, status);
    return json({ ok: true, status });
  });
}
