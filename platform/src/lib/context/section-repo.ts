// "Section modes" (write text | use a file), Data sources linked to a context section, and the EFFECTIVE content
// the assistant uses. Storage is the data layer (getData().sections / sources / chunks); this module holds the rules.
import { getData } from "../data";
import type { SectionChunkInput, SectionMode, SourceText } from "../data/types";
import { CONTEXT_SECTION_KEYS, type ContextSectionKey, type SourceStatus } from "../types";

export type { SectionMode, SourceText };
export type SectionChunk = SectionChunkInput;

/** Sections whose content always goes into the system prompt (never retrieved as chunks). */
export const ALWAYS_ON_SECTIONS: ReadonlySet<string> = new Set<ContextSectionKey>(["dos_donts", "escalation"]);
/** Max characters of an always-on section (own text + linked sources) that may reach the prompt. */
export const ALWAYS_ON_CAP = 20_000;
export const TRUNCATION_NOTE = "[... texto recortado: el resto de este archivo/fuente no se incluye / text truncated]";
export const PREVIEW_CHARS = 400;

export const isSectionKey = (k: unknown): k is ContextSectionKey => typeof k === "string" && (CONTEXT_SECTION_KEYS as readonly string[]).includes(k);

// ---------- section meta (mode + file) ----------
export interface SectionMeta { mode: SectionMode; fileSourceId: string | null }

export async function listSectionMeta(tenantId: string): Promise<Record<ContextSectionKey, SectionMeta>> {
  const rows = await getData().sections.listRows(tenantId);
  return Object.fromEntries(rows.map((r) => [r.key, { mode: r.mode, fileSourceId: r.fileSourceId }])) as Record<ContextSectionKey, SectionMeta>;
}
export const getSectionMeta = async (tenantId: string, key: ContextSectionKey): Promise<SectionMeta> => (await listSectionMeta(tenantId))[key];

/** Ids of sources that are the uploaded file of some section (hidden from the general Sources list). */
export async function sectionFileSourceIds(tenantId: string): Promise<Set<string>> {
  const rows = await getData().sections.listRows(tenantId);
  return new Set(rows.map((r) => r.fileSourceId).filter((id): id is string => !!id));
}

export const listSectionSourceIds = async (tenantId: string, key: ContextSectionKey): Promise<string[]> =>
  (await getData().sections.listLinks(tenantId)).filter((l) => l.sectionKey === key).map((l) => l.sourceId);

// ---------- effective content ----------
export interface EffectiveSection {
  key: ContextSectionKey;
  /** Mode the user chose. */
  mode: SectionMode;
  /** What is really used: "file" only when the mode is file AND the file is indexed with text. */
  using: SectionMode;
  /** Typed text (kept as a draft while the file mode is active). */
  typed: string;
  /** Own content the assistant uses (file text or typed text), without linked sources. */
  own: string;
  /** Text for the assistant: `own` + linked sources for always-on sections (capped), `own` otherwise. */
  text: string;
  file: { id: string; title: string; status: SourceStatus; error: string | null } | null;
  /** File mode is on but the file is missing, not indexed yet, failed or empty: the typed text is used instead. */
  fileFailed: boolean;
  linked: { id: string; title: string; status: SourceStatus; text: string }[];
  truncated: boolean;
}

function cap(s: string, max: number): { text: string; truncated: boolean } {
  return s.length <= max ? { text: s, truncated: false } : { text: `${s.slice(0, max).trimEnd()}\n${TRUNCATION_NOTE}`, truncated: true };
}

/** The text the assistant must use for one section. Never throws for a valid key. */
export async function getEffectiveSectionContent(tenantId: string, key: ContextSectionKey): Promise<EffectiveSection> {
  const data = getData();
  const row = await data.sections.getRow(tenantId, key);
  const typed = row?.content ?? "";
  const mode: SectionMode = row?.mode === "file" ? "file" : "text";
  const fileSrc = row?.fileSourceId ? await data.sources.getText(tenantId, row.fileSourceId) : null;
  const fileOk = !!fileSrc && fileSrc.status === "indexed" && fileSrc.text.trim().length > 0;
  const using: SectionMode = mode === "file" && fileOk ? "file" : "text";
  const own = (using === "file" ? fileSrc!.text : typed).trim();
  const linkedSrc = await Promise.all((await listSectionSourceIds(tenantId, key)).map((id) => data.sources.getText(tenantId, id)));
  const linked = linkedSrc
    .filter((s): s is SourceText => !!s)
    .map((s) => ({ id: s.id, title: s.title, status: s.status, text: s.status === "indexed" ? s.text.trim() : "" }));

  let text = own;
  let truncated = false;
  if (ALWAYS_ON_SECTIONS.has(key)) {
    const parts = [own, ...linked.filter((l) => l.text).map((l) => `[${l.title}]\n${l.text}`)].filter(Boolean);
    ({ text, truncated } = cap(parts.join("\n\n"), ALWAYS_ON_CAP));
  }
  return {
    key, mode, using, typed, own, text, truncated, linked,
    file: fileSrc ? { id: fileSrc.id, title: fileSrc.title, status: fileSrc.status, error: fileSrc.error } : null,
    fileFailed: mode === "file" && !fileOk,
  };
}

/** A section counts as filled when the content the assistant uses (typed text or indexed file) or a linked source has text. */
export const isSectionFilled = (e: EffectiveSection, minChars = 1): boolean =>
  e.own.trim().length >= minChars || e.linked.some((l) => l.text.length >= minChars);
