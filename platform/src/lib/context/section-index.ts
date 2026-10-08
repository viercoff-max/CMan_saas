// Section indexing: a section's retrieval chunks come from its EFFECTIVE content (typed text, or the section file
// when "Usar un archivo" is on and the file is indexed) plus the Data sources linked to it.
// Linked-source chunks carry both sectionKey and sourceId, so deleting the source still removes them.
// A source used by any section has no general (section-less) chunks, so nothing is retrieved twice.
import fs from "node:fs/promises";
import { deleteSource, replaceChunks } from "../store";
import type { ContextSectionKey } from "../types";
import { chunkText } from "./chunk";
import { dict } from "./dict";
import { resolveUploadPath } from "./upload-path";
import {
  deleteGeneralSourceChunks, getEffectiveSectionContent, getSourceText, removeSourceReferences, replaceSectionChunks,
  sectionsForSource, type SectionChunk,
} from "./section-repo";

/**
 * Re-chunk one section from the database. `_content` is accepted for backward compatibility (callers save the
 * typed text first); the stored effective content is always what gets indexed.
 */
export function reindexSection(tenantId: string, key: ContextSectionKey, _content?: string): number {
  void _content;
  const title = dict.es[`sec.${key}.title`] ?? key;
  const eff = getEffectiveSectionContent(tenantId, key);
  const ownSourceId = eff.using === "file" && eff.file ? eff.file.id : null;
  const chunks: SectionChunk[] = chunkText(eff.own, title).map((c) => ({ sourceId: ownSourceId, title: c.title, text: c.text }));
  for (const l of eff.linked) {
    if (!l.text) continue;
    for (const c of chunkText(l.text, l.title)) chunks.push({ sourceId: l.id, title: c.title, text: c.text });
  }
  replaceSectionChunks(tenantId, key, chunks);
  // The section file (even when the text mode is active) and linked sources are only read through the section.
  if (eff.file) deleteGeneralSourceChunks(tenantId, eff.file.id);
  for (const l of eff.linked) deleteGeneralSourceChunks(tenantId, l.id);
  return chunks.length;
}

/** After a source was (re)indexed: refresh every section that uses it. Returns the sections refreshed. */
export function refreshSourceSections(tenantId: string, sourceId: string): ContextSectionKey[] {
  const keys = sectionsForSource(tenantId, sourceId);
  for (const k of keys) reindexSection(tenantId, k);
  if (keys.length) deleteGeneralSourceChunks(tenantId, sourceId);
  return keys;
}

/** A source no longer used by any section goes back to the general knowledge (re-chunked from its saved text). */
export function restoreGeneralSourceChunks(tenantId: string, sourceId: string): void {
  if (sectionsForSource(tenantId, sourceId).length) return;
  const s = getSourceText(tenantId, sourceId);
  if (!s || s.status !== "indexed" || !s.text.trim()) return;
  replaceChunks(tenantId, { sourceId }, chunkText(s.text, s.title));
}

/** Deletes a source everywhere: uploaded file, section links / section file, chunks, row. Sections are re-indexed. */
export async function deleteSourceAndLinks(tenantId: string, sourceId: string): Promise<boolean> {
  const s = getSourceText(tenantId, sourceId);
  if (!s) return false;
  if (s.filePath) {
    const full = resolveUploadPath(tenantId, s.filePath);
    if (full) await fs.rm(full, { force: true }).catch(() => undefined);
  }
  const keys = removeSourceReferences(tenantId, sourceId);
  deleteSource(tenantId, sourceId);
  for (const k of keys) reindexSection(tenantId, k);
  return true;
}

/** Same as deleteSourceAndLinks without touching the disk (demo rows, tests). */
export function deleteSourceRowAndLinks(tenantId: string, sourceId: string): void {
  const keys = removeSourceReferences(tenantId, sourceId);
  deleteSource(tenantId, sourceId);
  for (const k of keys) reindexSection(tenantId, k);
}
