"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { audit, createSource, getContextSections, saveContextSection } from "@/lib/store";
import { CONTEXT_SECTION_KEYS, type ContextSectionKey } from "@/lib/types";
import { indexSource, reindexSection } from "@/lib/context";
import { deleteSourceAndLinks, restoreGeneralSourceChunks } from "@/lib/context/section-index";
import {
  getSectionMeta, linkSectionSource, listSectionMeta, listSectionSourceIds, sectionFileSourceIds, setSectionMode,
  sourceBelongsToTenant, unlinkSectionSource,
} from "@/lib/context/section-repo";
import { hit } from "@/lib/security/rate-limit";

const sectionKey = z.enum(CONTEXT_SECTION_KEYS);
const schema = z.object({
  // Exhaustive (zod v4 record over an enum): the screen always sends every section.
  sections: z.record(sectionKey, z.string().max(30000)),
  /** Per-section mode ('text' = typed text, 'file' = the uploaded file). Optional for older clients. */
  modes: z.partialRecord(sectionKey, z.enum(["text", "file"])).optional(),
});

export type SaveContextResult = { ok: boolean; changed: number };
export type SectionActionResult = { ok: boolean; error?: string };

/** Saves every section whose text or mode changed and re-chunks it. tenantId always comes from the session. */
export async function saveContextAction(input: unknown): Promise<SaveContextResult> {
  const s = await requireSession();
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false, changed: 0 };
  const current = new Map(getContextSections(s.tenantId).map((c) => [c.key, c.content]));
  const meta = listSectionMeta(s.tenantId);
  let changed = 0;
  for (const k of CONTEXT_SECTION_KEYS) {
    const content = parsed.data.sections[k];
    const mode = parsed.data.modes?.[k];
    const textChanged = content !== undefined && (current.get(k) ?? "") !== content;
    const modeChanged = mode !== undefined && meta[k].mode !== mode;
    if (!textChanged && !modeChanged) continue;
    // The typed text is always kept (it is the draft while the file mode is on).
    if (textChanged) saveContextSection(s.tenantId, k, content!);
    if (modeChanged) setSectionMode(s.tenantId, k, mode!);
    reindexSection(s.tenantId, k);
    changed++;
  }
  if (changed) audit(s.tenantId, s.userId, "context.save", `${changed} sections`);
  return { ok: true, changed };
}

/** "Quitar": deletes the section file (file on disk, source row, chunks) and goes back to the typed text. */
export async function removeSectionFileAction(input: unknown): Promise<SectionActionResult> {
  const s = await requireSession();
  const p = z.object({ key: sectionKey }).safeParse(input);
  if (!p.success) return { ok: false, error: "invalid" };
  const fileId = getSectionMeta(s.tenantId, p.data.key).fileSourceId;
  if (fileId) await deleteSourceAndLinks(s.tenantId, fileId); // also sets mode 'text' and re-indexes the section
  setSectionMode(s.tenantId, p.data.key, "text");
  reindexSection(s.tenantId, p.data.key);
  audit(s.tenantId, s.userId, "context.section_file_remove", p.data.key);
  revalidatePath("/context");
  return { ok: true };
}

/** Links or unlinks one existing Data source to a section ("Complementar con fuentes de datos"). */
export async function setSectionSourceAction(input: unknown): Promise<SectionActionResult> {
  const s = await requireSession();
  const p = z.object({ key: sectionKey, sourceId: z.uuid(), linked: z.boolean() }).safeParse(input);
  if (!p.success) return { ok: false, error: "invalid" };
  const { key, sourceId, linked } = p.data;
  if (!sourceBelongsToTenant(s.tenantId, sourceId) || sectionFileSourceIds(s.tenantId).has(sourceId)) return { ok: false, error: "not_found" };
  if (linked) {
    if (!listSectionSourceIds(s.tenantId, key).includes(sourceId)) linkSectionSource(s.tenantId, key, sourceId);
    reindexSection(s.tenantId, key);
  } else {
    unlinkSectionSource(s.tenantId, key, sourceId);
    reindexSection(s.tenantId, key);
    restoreGeneralSourceChunks(s.tenantId, sourceId); // back to general knowledge when no section uses it
  }
  audit(s.tenantId, s.userId, linked ? "context.link_source" : "context.unlink_source", `${key} ${sourceId}`);
  revalidatePath("/context");
  return { ok: true };
}

const linkSchema = z.object({
  key: sectionKey,
  url: z.string().trim().max(2000).refine((u) => {
    try { const pr = new URL(u).protocol; return pr === "http:" || pr === "https:"; } catch { return false; }
  }),
});

/** "Agregar enlace": creates a link source, links it to the section and indexes it in one step. */
export async function addSectionLinkAction(input: unknown): Promise<SectionActionResult & { id?: string }> {
  const s = await requireSession();
  const p = linkSchema.safeParse(input);
  if (!p.success) return { ok: false, error: "invalid_url" };
  if (!hit(`section-link:${s.tenantId}`, 30, 60 * 60_000).ok) return { ok: false, error: "rate_limited" };
  const url = new URL(p.data.url);
  const title = (url.hostname + (url.pathname !== "/" ? url.pathname : "")).slice(0, 120);
  const src = createSource(s.tenantId, { kind: "link", title, url: url.toString() });
  linkSectionSource(s.tenantId, p.data.key as ContextSectionKey, src.id);
  audit(s.tenantId, s.userId, "source.add", `link ${src.id} section ${p.data.key}`);
  const r = await indexSource(s.tenantId, src.id); // the section is re-indexed by the indexing hook
  revalidatePath("/context");
  revalidatePath("/sources");
  return { ok: true, id: src.id, error: r.ok ? undefined : r.error };
}
