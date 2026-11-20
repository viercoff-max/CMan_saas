// Context sections, section links, sources and chunks (Supabase).
// sources.storage_path holds the file path (SQLite: file_path): the object path "<tenant_id>/<key>" in the private
// "tenant-files" Storage bucket, written by src/lib/storage (getFileStore().put returns it). sources.create refuses a
// file path that does not start with THIS tenant's id, so a row can never point at another tenant's object.
import { nowIso } from "../../ids";
import { CONTEXT_SECTION_KEYS, type ContextSectionKey } from "../../types";
import { DataValidationError } from "../errors";
import type { ChunksRepo, SectionRow, SectionsRepo, SourcesRepo, SourceText } from "../types";
import { isUuid, scoped, type Db, type Row, type Scoped } from "./client";
import { allRows, cap, mapChunk, mapSectionRow, mapSource, one, rows, run } from "./map";

const isSectionKey = (k: unknown): k is ContextSectionKey => typeof k === "string" && (CONTEXT_SECTION_KEYS as readonly string[]).includes(k);
const assertKey = (k: unknown) => { if (!isSectionKey(k)) throw new Error("invalid section"); };

async function sourceExists(s: Scoped, id: string): Promise<boolean> {
  if (!isUuid(id)) return false;
  return !!(await one(s.from("sources").select("id").eq("id", id).maybeSingle(), "sources.exists"));
}

async function sectionRows(s: Scoped): Promise<SectionRow[]> {
  const rs = await rows(s.from("context_sections").select("key, content, mode, file_source_id, updated_at"), "sections.list");
  const by = new Map(rs.map((r) => [r.key as string, r]));
  return CONTEXT_SECTION_KEYS.map((key) => {
    const r = by.get(key);
    return r ? mapSectionRow(r) : { key, content: "", mode: "text" as const, fileSourceId: null, updatedAt: "" };
  });
}

async function sectionsForSource(s: Scoped, sourceId: string): Promise<ContextSectionKey[]> {
  if (!isUuid(sourceId)) return [];
  const linked = await rows(s.from("section_sources").select("section_key").eq("source_id", sourceId), "sections.sectionsForSource");
  const files = await rows(s.from("context_sections").select("key").eq("file_source_id", sourceId), "sections.sectionsForSource");
  return [...new Set([...linked.map((r) => r.section_key as string), ...files.map((r) => r.key as string)])].filter(isSectionKey);
}

/** Upsert of the given section columns only (PostgREST merges just the sent columns; content defaults to ''). */
const upsertSection = (s: Scoped, key: ContextSectionKey, cols: Row, ctx: string) =>
  run(s.from("context_sections").upsert({ key, ...cols, updated_at: nowIso() }, { onConflict: "tenant_id,key" }), ctx);

export function sectionsRepo(db: Db): SectionsRepo {
  return {
    async list(tenantId) {
      return (await sectionRows(scoped(db, tenantId))).map((r) => ({ key: r.key, content: r.content, updatedAt: r.updatedAt }));
    },
    async listRows(tenantId) { return sectionRows(scoped(db, tenantId)); },
    async getRow(tenantId, key) {
      if (!isSectionKey(key)) return null;
      const r = await one(scoped(db, tenantId).from("context_sections").select("key, content, mode, file_source_id, updated_at").eq("key", key).maybeSingle(), "sections.getRow");
      return r ? mapSectionRow(r) : null;
    },
    async saveContent(tenantId, key, content) {
      assertKey(key);
      await upsertSection(scoped(db, tenantId), key, { content }, "sections.saveContent");
    },
    async setMode(tenantId, key, mode) {
      assertKey(key);
      await upsertSection(scoped(db, tenantId), key, { mode: mode === "file" ? "file" : "text" }, "sections.setMode");
    },
    async setFile(tenantId, key, sourceId) {
      assertKey(key);
      if (sourceId !== null && !isUuid(sourceId)) throw new DataValidationError("fileSourceId");
      // The composite FK (tenant_id, file_source_id) also rejects another tenant's source.
      await upsertSection(scoped(db, tenantId), key, { file_source_id: sourceId }, "sections.setFile");
    },
    async listLinks(tenantId) {
      // ON DELETE CASCADE of the composite FK guarantees every link's source still exists.
      return (await rows(scoped(db, tenantId).from("section_sources").select("section_key, source_id, created_at").order("created_at").order("source_id"), "sections.listLinks"))
        .filter((r) => isSectionKey(r.section_key))
        .map((r) => ({ sectionKey: r.section_key as ContextSectionKey, sourceId: r.source_id as string }));
    },
    async link(tenantId, key, sourceId) {
      const s = scoped(db, tenantId);
      if (!isSectionKey(key) || !(await sourceExists(s, sourceId))) return false;
      await run(s.from("section_sources").upsert({ section_key: key, source_id: sourceId }, { onConflict: "tenant_id,section_key,source_id", ignoreDuplicates: true }), "sections.link");
      return true;
    },
    async unlink(tenantId, key, sourceId) {
      if (!isSectionKey(key) || !isUuid(sourceId)) return;
      await run(scoped(db, tenantId).from("section_sources").delete().eq("section_key", key).eq("source_id", sourceId), "sections.unlink");
    },
    async sectionsForSource(tenantId, sourceId) { return sectionsForSource(scoped(db, tenantId), sourceId); },
    async removeSourceReferences(tenantId, sourceId) {
      const s = scoped(db, tenantId);
      const keys = await sectionsForSource(s, sourceId);
      if (!keys.length) return keys;
      await run(s.from("section_sources").delete().eq("source_id", sourceId), "sections.removeSourceReferences");
      await run(s.from("context_sections").update({ file_source_id: null, mode: "text", updated_at: nowIso() }).eq("file_source_id", sourceId), "sections.removeSourceReferences");
      return keys;
    },
  };
}

export function sourcesRepo(db: Db): SourcesRepo {
  const get = async (s: Scoped, id: string) => {
    if (!isUuid(id)) return null;
    const r = await one(s.from("sources").select("id, tenant_id, kind, title, url, storage_path, status, error, last_synced_at, created_at").eq("id", id).maybeSingle(), "sources.get");
    return r ? mapSource(r) : null;
  };
  return {
    async list(tenantId) {
      const s = scoped(db, tenantId);
      return (await allRows(() => s.from("sources").select("id, tenant_id, kind, title, url, storage_path, status, error, last_synced_at, created_at").order("created_at", { ascending: false }).order("id"), "sources.list")).map(mapSource);
    },
    async get(tenantId, id) { return get(scoped(db, tenantId), id); },
    async getText(tenantId, id): Promise<SourceText | null> {
      if (!isUuid(id)) return null;
      const r = await one(scoped(db, tenantId).from("sources").select("id, kind, title, url, storage_path, status, error, content_text").eq("id", id).maybeSingle(), "sources.getText");
      if (!r) return null;
      const m = mapSource(r);
      return { id: m.id, kind: m.kind, title: m.title, url: m.url, filePath: m.filePath, status: m.status, error: m.error, text: String(r.content_text ?? "") };
    },
    async exists(tenantId, id) { return sourceExists(scoped(db, tenantId), id); },
    async create(tenantId, src) {
      const s = scoped(db, tenantId);
      if (src.kind === "file") {
        const p = String(src.filePath ?? "");
        // Server-built object path: "<this tenant uuid>/<key>", no traversal, within the column CHECK (500).
        if (!p.startsWith(`${s.tenantId}/`) || p.length > 500 || p.split("/").some((seg) => !seg || seg === "." || seg === ".."))
          throw new DataValidationError("filePath");
      }
      const r = await one(s.from("sources").insert({ kind: src.kind, title: cap(src.title, 300), url: src.url ?? null, storage_path: src.filePath ?? null }).select("id").maybeSingle(), "sources.create");
      const created = r ? await get(s, r.id as string) : null;
      if (!created) throw new Error("source row missing after insert");
      return created;
    },
    async updateStatus(tenantId, id, status, error, contentText) {
      if (!isUuid(id)) return;
      const patch: Row = { status, error: error === undefined || error === null ? null : cap(error, 200), last_synced_at: nowIso() };
      if (contentText !== undefined && contentText !== null) patch.content_text = contentText;
      await run(scoped(db, tenantId).from("sources").update(patch).eq("id", id), "sources.updateStatus");
    },
    async delete(tenantId, id) {
      if (!isUuid(id)) return;
      const s = scoped(db, tenantId);
      // Explicit (the composite FKs would cascade/clear them too): chunks, links, then the row.
      await run(s.from("chunks").delete().eq("source_id", id), "sources.delete");
      await run(s.from("section_sources").delete().eq("source_id", id), "sources.delete");
      await run(s.from("context_sections").update({ file_source_id: null }).eq("file_source_id", id), "sources.delete");
      await run(s.from("sources").delete().eq("id", id), "sources.delete");
    },
  };
}

export function chunksRepo(db: Db): ChunksRepo {
  const insert = async (s: Scoped, list: Row[], ctx: string) => {
    for (let i = 0; i < list.length; i += 500) await run(s.from("chunks").insert(list.slice(i, i + 500)), ctx);
  };
  return {
    async list(tenantId) {
      const s = scoped(db, tenantId);
      return (await allRows(() => s.from("chunks").select("id, tenant_id, source_id, section_key, title, text").order("created_at").order("id"), "chunks.list")).map(mapChunk);
    },
    async replace(tenantId, owner, list) {
      const s = scoped(db, tenantId);
      if (owner.sourceId !== undefined && owner.sourceId !== null && !isUuid(owner.sourceId)) return;
      if (owner.sourceId) await run(s.from("chunks").delete().eq("source_id", owner.sourceId), "chunks.replace");
      if (owner.sectionKey) await run(s.from("chunks").delete().eq("section_key", owner.sectionKey), "chunks.replace");
      await insert(s, list.map((c) => ({ source_id: owner.sourceId ?? null, section_key: owner.sectionKey ?? null, title: c.title ?? "", text: c.text })), "chunks.replace");
    },
    async replaceSection(tenantId, key, list) {
      const s = scoped(db, tenantId);
      await run(s.from("chunks").delete().eq("section_key", key), "chunks.replaceSection");
      await insert(s, list.map((c) => ({ source_id: c.sourceId, section_key: key, title: c.title, text: c.text })), "chunks.replaceSection");
    },
    async deleteGeneralForSource(tenantId, sourceId) {
      if (!isUuid(sourceId)) return;
      await run(scoped(db, tenantId).from("chunks").delete().eq("source_id", sourceId).is("section_key", null), "chunks.deleteGeneralForSource");
    },
  };
}
