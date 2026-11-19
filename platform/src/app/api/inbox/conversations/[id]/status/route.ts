import { z } from "zod";
import { withSession, json } from "@/lib/channels/api";
import { checkSameOrigin } from "@/lib/security/origin";
import { getData } from "@/lib/data";
import type { ConversationStatus } from "@/lib/types";

const Body = z.object({ action: z.enum(["take", "return", "resolve"]) });
const MAP: Record<"take" | "return" | "resolve", ConversationStatus> = { take: "human", return: "bot", resolve: "resolved" };

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const bad = checkSameOrigin(req); if (bad) return bad;
  const { id } = await ctx.params;
  return withSession(async (s) => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: "invalid_body" }, 400);
    const data = getData();
    if (!(await data.conversations.get(s.tenantId, id))) return json({ error: "not_found" }, 404);
    const status = MAP[parsed.data.action];
    await data.conversations.setStatus(s.tenantId, id, status);
    if (status === "bot" || status === "resolved") await data.conversations.resetForBot(s.tenantId, id);
    await data.audit.log(s.tenantId, s.userId, "inbox.status", `${id}:${status}`);
    return json({ ok: true, status });
  });
}
