// Internal notes: POST { body } adds one (any team member); DELETE ?note=<id> removes your own note.
// Notes are never sent to the customer and never reach the AI.
import { z } from "zod";
import { withSession, json } from "@/lib/channels/api";
import { checkSameOrigin } from "@/lib/security/origin";
import { getData } from "@/lib/data";

const Body = z.object({ body: z.string().trim().min(1).max(4000) });

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const bad = checkSameOrigin(req); if (bad) return bad;
  const { id } = await ctx.params;
  return withSession(async (s) => {
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return json({ error: "invalid_body" }, 400);
    const data = getData();
    const note = await data.notes.add(s.tenantId, id, { authorUserId: s.userId, body: parsed.data.body });
    if (!note) return json({ error: "not_found" }, 404);
    await data.events.add(s.tenantId, id, { actorUserId: s.userId, kind: "note", detail: { noteId: note.id } });
    await data.audit.log(s.tenantId, s.userId, "inbox.note", id);
    return json({ ok: true, note });
  });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const bad = checkSameOrigin(req); if (bad) return bad;
  const { id } = await ctx.params;
  return withSession(async (s) => {
    const noteId = new URL(req.url).searchParams.get("note") ?? "";
    if (!noteId || noteId.length > 64) return json({ error: "invalid_body" }, 400);
    const data = getData();
    if (!(await data.conversations.get(s.tenantId, id))) return json({ error: "not_found" }, 404);
    const ok = await data.notes.remove(s.tenantId, noteId, s.userId);
    if (!ok) return json({ error: "not_found" }, 404);
    await data.audit.log(s.tenantId, s.userId, "inbox.note_delete", id);
    return json({ ok: true });
  });
}
