// Data access for "section modes" (write text | use a file) and Data sources linked to a context section.
// Every function takes tenantId. Tables/columns come from the additive migration in db.ts (runMigrations).
import { getDb, runMigrations } from "../db";
import { newId, nowIso } from "../ids";
import { CONTEXT_SECTION_KEYS, type ContextSectionKey, type SourceKind, type SourceStatus } from "../types";

type Row = Record<string, unknown>;
export type SectionMode = "text" | "file";

/** Sections whose content always goes into the system prompt (never retrieved as chunks). */
export const ALWAYS_ON_SECTIONS: ReadonlySet<string> = new Set<ContextSectionKey>(["dos_donts", "escalation"]);
/** Max characters of an always-on section (own text + linked sources) that may reach the prompt. */
export const ALWAYS_ON_CAP = 20_000;
export const TRUNCATION_NOTE = "[... texto recortado: el resto de este archivo/fuente no se incluye / text truncated]";
export const PREVIEW_CHARS = 400;

const g = globalThis as { __sectionSchemaReady?: unknown };
/** Runs the migration once per DB handle (a dev server may hold a handle opened by an older build). */
function db() {
  const d = getDb();
  if (g.__sectionSchemaReady !== d) { runMigrations(d); g.__sectionSchemaReady = d; }
  return d;
}

export const isSectionKey = (k: unknown): k is ContextSectionKey => typeof k === "string" && (CONTEXT_SECTION_KEYS as readonly string[]).includes(k);

// ---------- section meta (mode + file) ----------
export interface SectionMeta { mode: SectionMode; fileSourceId: string | null }

export function listSectionMeta(tenantId: string): Record<ContextSectionKey, SectionMeta> {
  const rows = db().prepare("SELECT key, mode, file_source_id FROM context_sections WHERE tenant_id = ?").all(tenantId) as Row[];
  const by = new Map(rows.map((r) => [r.key as string, r]));
  return Object.fromEntries(CONTEXT_SECTION_KEYS.map((k) => {
    const r = by.get(k);
    return [k, { mode: r?.mode === "file" ? "file" : "text", fileSourceId: (r?.file_source_id as string) ?? null }];
  })) as Record<ContextSectionKey, SectionMeta>;
}
export const getSectionMeta = (tenantId: string, key: ContextSectionKey): SectionMeta => listSectionMeta(tenantId)[key];

/** Upsert: creates the section row (empty text) when it does not exist yet. */
function upsertMeta(tenantId: string, key: ContextSectionKey, set: string, args: (string | null)[]): void {
  if (!isSectionKey(key)) throw new Error("invalid section");
  const d = db();
  d.prepare("INSERT OR IGNORE INTO context_sections (id, tenant_id, key, content, updated_at) VALUES (?,?,?,'',?)").run(newId(), tenantId, key, nowIso());
  d.prepare(`UPDATE context_sections SET ${set}, updated_at=? WHERE tenant_id=? AND key=?`).run(...args, nowIso(), tenantId, key);
}
export function setSectionMode(tenantId: string, key: ContextSectionKey, mode: SectionMode): void {
  upsertMeta(tenantId, key, "mode=?", [mode === "file" ? "file" : "text"]);
}
export function setSectionFile(tenantId: string, key: ContextSectionKey, sourceId: string | null): void {
  upsertMeta(tenantId, key, "file_source_id=?", [sourceId]);
}

/** Ids of sources that are the uploaded file of some section (hidden from the general Sources list). */
export function sectionFileSourceIds(tenantId: string): Set<string> {
  const rows = db().prepare("SELECT file_source_id FROM context_sections WHERE tenant_id=? AND file_source_id IS NOT NULL").all(tenantId) as Row[];
  return new Set(rows.map((r) => r.file_source_id as string));
}

// ---------- linked sources ----------
export function listSectionLinks(tenantId: string): { sectionKey: ContextSectionKey; sourceId: string }[] {
  return (db().prepare(
    `SELECT l.section_key, l.source_id FROM section_sources l JOIN sources s ON s.tenant_id = l.tenant_id AND s.id = l.source_id
     WHERE l.tenant_id = ? ORDER BY l.created_at, l.source_id`
  ).all(tenantId) as Row[])
    .filter((r) => isSectionKey(r.section_key))
    .map((r) => ({ sectionKey: r.section_key as ContextSectionKey, sourceId: r.source_id as string }));
}
export const listSectionSourceIds = (tenantId: string, key: ContextSectionKey): string[] =>
  listSectionLinks(tenantId).filter((l) => l.sectionKey === key).map((l) => l.sourceId);

/** True when the source exists for this tenant (cross-tenant ids are refused). */
export function sourceBelongsToTenant(tenantId: string, sourceId: string): boolean {
  return !!db().prepare("SELECT 1 FROM sources WHERE tenant_id=? AND id=?").get(tenantId, sourceId);
}

export function linkSectionSource(tenantId: string, key: ContextSectionKey, sourceId: string): boolean {
  if (!isSectionKey(key) || !sourceBelongsToTenant(tenantId, sourceId)) return false;
  db().prepare("INSERT OR IGNORE INTO section_sources (tenant_id, section_key, source_id) VALUES (?,?,?)").run(tenantId, key, sourceId);
  return true;
}
export function unlinkSectionSource(tenantId: string, key: ContextSectionKey, sourceId: string): void {
  db().prepare("DELETE FROM section_sources WHERE tenant_id=? AND section_key=? AND source_id=?").run(tenantId, key, sourceId);
}

/** Sections that use this source, as linked source or as the section file. */
export function sectionsForSource(tenantId: string, sourceId: string): ContextSectionKey[] {
  const d = db();
  const linked = (d.prepare("SELECT section_key FROM section_sources WHERE tenant_id=? AND source_id=?").all(tenantId, sourceId) as Row[]).map((r) => r.section_key as string);
  const files = (d.prepare("SELECT key FROM context_sections WHERE tenant_id=? AND file_source_id=?").all(tenantId, sourceId) as Row[]).map((r) => r.key as string);
  return [...new Set([...linked, ...files])].filter(isSectionKey);
}

/** Removes every reference to a source (links + section file). Returns the sections that changed. */
export function removeSourceReferences(tenantId: string, sourceId: string): ContextSectionKey[] {
  const keys = sectionsForSource(tenantId, sourceId);
  const d = db();
  d.prepare("DELETE FROM section_sources WHERE tenant_id=? AND source_id=?").run(tenantId, sourceId);
  d.prepare("UPDATE context_sections SET file_source_id=NULL, mode='text', updated_at=? WHERE tenant_id=? AND file_source_id=?").run(nowIso(), tenantId, sourceId);
  return keys;
}

// ---------- source text (store.ts maps sources without content_text) ----------
export interface SourceText {
  id: string; kind: SourceKind; title: string; url: string | null; filePath: string | null;
  status: SourceStatus; error: string | null; text: string;
}
export function getSourceText(tenantId: string, sourceId: string): SourceText | null {
  const r = db().prepare("SELECT id, kind, title, url, file_path, status, error, content_text FROM sources WHERE tenant_id=? AND id=?").get(tenantId, sourceId) as Row | undefined;
  if (!r) return null;
  return {
    id: r.id as string, kind: r.kind as SourceKind, title: r.title as string, url: (r.url as string) ?? null,
    filePath: (r.file_path as string) ?? null, status: r.status as SourceStatus, error: (r.error as string) ?? null,
    text: String(r.content_text ?? ""),
  };
}

// ---------- chunks ----------
export interface SectionChunk { sourceId: string | null; title: string; text: string }
/** Replace every chunk tagged with this section (own text/file + linked sources). */
export function replaceSectionChunks(tenantId: string, key: ContextSectionKey, chunks: SectionChunk[]): void {
  const d = db();
  d.prepare("DELETE FROM chunks WHERE tenant_id=? AND section_key=?").run(tenantId, key);
  const ins = d.prepare("INSERT INTO chunks (id, tenant_id, source_id, section_key, title, text) VALUES (?,?,?,?,?,?)");
  for (const c of chunks) ins.run(newId(), tenantId, c.sourceId, key, c.title, c.text);
}
/** Drop the general (section-less) chunks of a source that is now read through a section, so nothing is duplicated. */
export function deleteGeneralSourceChunks(tenantId: string, sourceId: string): void {
  db().prepare("DELETE FROM chunks WHERE tenant_id=? AND source_id=? AND section_key IS NULL").run(tenantId, sourceId);
}

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
export function getEffectiveSectionContent(tenantId: string, key: ContextSectionKey): EffectiveSection {
  const row = db().prepare("SELECT content, mode, file_source_id FROM context_sections WHERE tenant_id=? AND key=?").get(tenantId, key) as Row | undefined;
  const typed = String(row?.content ?? "");
  const mode: SectionMode = row?.mode === "file" ? "file" : "text";
  const fileSrc = row?.file_source_id ? getSourceText(tenantId, row.file_source_id as string) : null;
  const fileOk = !!fileSrc && fileSrc.status === "indexed" && fileSrc.text.trim().length > 0;
  const using: SectionMode = mode === "file" && fileOk ? "file" : "text";
  const own = (using === "file" ? fileSrc!.text : typed).trim();
  const linked = listSectionSourceIds(tenantId, key)
    .map((id) => getSourceText(tenantId, id))
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
