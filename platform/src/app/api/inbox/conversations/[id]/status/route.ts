import { z } from "zod";
import { withSession, json } from "@/lib/channels/api";
import { checkSameOrigin } from "@/lib/security/origin";
import { resetConversationForBot } from "@/lib/channels/repo";
import { audit, getConversation, setConversationStatus } from "@/lib/store";
import type { ConversationStatus } from "@/lib/types";

const Body = z.object({ action: z.enum(["take", "return", "resolve"]) });
const MAP: Record<"take" | "return" | "resolve", ConversationStatus> = { take: "human", return: "bot", resolve: "resolved" };

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const bad = checkSameOrigin(req); if (bad) return bad;
  const { id } = await ctx.params;
  return withSession(async (s) => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: "invalid_body" }, 400);
    if (!getConversation(s.tenantId, id)) return json({ error: "not_found" }, 404);
    const status = MAP[parsed.data.action];
    setConversationStatus(s.tenantId, id, status);
    if (status === "bot" || status === "resolved") resetConversationForBot(s.tenantId, id);
    audit(s.tenantId, s.userId, "inbox.status", `${id}:${status}`);
    return json({ ok: true, status });
  });
}
