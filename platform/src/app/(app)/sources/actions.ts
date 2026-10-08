"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { audit, createSource, getSource } from "@/lib/store";
import { indexSource } from "@/lib/context/index-source";
import { deleteSourceAndLinks } from "@/lib/context/section-index";

export type ActionResult = { ok: boolean; error?: string; chunks?: number };

const linkSchema = z.object({
  url: z.string().trim().max(2000).refine((u) => {
    try { const p = new URL(u).protocol; return p === "http:" || p === "https:"; } catch { return false; }
  }),
  title: z.string().trim().max(120).optional(),
});
const idSchema = z.object({ id: z.uuid() });

export async function addLinkAction(input: unknown): Promise<ActionResult> {
  const s = await requireSession();
  const p = linkSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "invalid_url" };
  const url = new URL(p.data.url);
  const title = p.data.title || url.hostname + (url.pathname !== "/" ? url.pathname : "");
  const src = createSource(s.tenantId, { kind: "link", title: title.slice(0, 120), url: url.toString() });
  audit(s.tenantId, s.userId, "source.add", `link ${src.id}`);
  const r = await indexSource(s.tenantId, src.id); // index right away so the user sees a result
  revalidatePath("/sources");
  return { ok: true, chunks: r.chunks, error: r.ok ? undefined : r.error };
}

export async function syncSourceAction(input: unknown): Promise<ActionResult> {
  const s = await requireSession();
  const p = idSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "not_found" };
  const r = await indexSource(s.tenantId, p.data.id); // also refreshes the Context sections linked to it
  revalidatePath("/sources");
  revalidatePath("/context");
  return { ok: r.ok, chunks: r.chunks, error: r.error };
}

export async function deleteSourceAction(input: unknown): Promise<ActionResult> {
  const s = await requireSession();
  const p = idSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "not_found" };
  const src = getSource(s.tenantId, p.data.id);
  if (!src) return { ok: false, error: "not_found" };
  // Removes the uploaded file, the chunks, and any Context section link / section file, then re-indexes those sections.
  await deleteSourceAndLinks(s.tenantId, src.id);
  audit(s.tenantId, s.userId, "source.delete", src.id);
  revalidatePath("/sources");
  revalidatePath("/context");
  return { ok: true };
}
