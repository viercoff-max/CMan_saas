// Context sections, section links, sources and chunks (SQLite).
import { newId, nowIso } from "../../ids";
import {
  CONTEXT_SECTION_KEYS, type ContextSectionKey, type Source, type SourceKind, type SourceStatus,
} from "../../types";
import type { ChunksRepo, SectionMode, SectionRow, SectionsRepo, SourcesRepo, SourceText } from "../types";
import { db, type Row } from "./conn";

const isSectionKey = (k: unknown): k is ContextSectionKey => typeof k === "string" && (CONTEXT_SECTION_KEYS as readonly string[]).includes(k);
const assertKey = (k: unknown) => { if (!isSectionKey(k)) throw new Error("invalid section"); };
const sourceExists = (tenantId: string, id: string) => !!db().prepare("SELECT 1 FROM sources WHERE tenant_id=? AND id=?").get(tenantId, id);

function sectionRows(tenantId: string): SectionRow[] {
  const rows = db().prepare("SELECT key, content, mode, file_source_id, updated_at FROM context_sections WHERE tenant_id = ?").all(tenantId) as Row[];
  const by = new Map(rows.map((r) => [r.key as string, r]));
  return CONTEXT_SECTION_KEYS.map((key) => {
    const r = by.get(key);
    return {
      key, content: (r?.content as string) ?? "", mode: (r?.mode === "file" ? "file" : "text") as SectionMode,
      fileSourceId: (r?.file_source_id as string) ?? null, updatedAt: (r?.updated_at as string) ?? "",
    };
  });
}

/** Upsert: creates the section row (empty text) when it does not exist yet. */
function upsertMeta(tenantId: string, key: ContextSectionKey, set: string, args: (string | null)[]): void {
  assertKey(key);
  const d = db();
  d.prepare("INSERT OR IGNORE INTO context_sections (id, tenant_id, key, content, updated_at) VALUES (?,?,?,'',?)").run(newId(), tenantId, key, nowIso());
  d.prepare(`UPDATE context_sections SET ${set}, updated_at=? WHERE tenant_id=? AND key=?`).run(...args, nowIso(), tenantId, key);
}

function sectionsForSource(tenantId: string, sourceId: string): ContextSectionKey[] {
  const d = db();
  const linked = (d.prepare("SELECT section_key FROM section_sources WHERE tenant_id=? AND source_id=?").all(tenantId, sourceId) as Row[]).map((r) => r.section_key as string);
  const files = (d.prepare("SELECT key FROM context_sections WHERE tenant_id=? AND file_source_id=?").all(tenantId, sourceId) as Row[]).map((r) => r.key as string);
  return [...new Set([...linked, ...files])].filter(isSectionKey);
}

export const sections: SectionsRepo = {
  async list(tenantId) {
    return sectionRows(tenantId).map((r) => ({ key: r.key, content: r.content, updatedAt: r.updatedAt }));
  },
  async listRows(tenantId) { return sectionRows(tenantId); },
  async getRow(tenantId, key) {
    const r = db().prepare("SELECT key, content, mode, file_source_id, updated_at FROM context_sections WHERE tenant_id=? AND key=?").get(tenantId, key) as Row | undefined;
    if (!r || !isSectionKey(r.key)) return null;
    return {
      key: r.key, content: String(r.content ?? ""), mode: r.mode === "file" ? "file" : "text",
      fileSourceId: (r.file_source_id as string) ?? null, updatedAt: String(r.updated_at ?? ""),
    };
  },
  async saveContent(tenantId, key, content) {
    assertKey(key);
    db().prepare(
      `INSERT INTO context_sections (id, tenant_id, key, content, updated_at) VALUES (?,?,?,?,?)
       ON CONFLICT(tenant_id, key) DO UPDATE SET content=excluded.content, updated_at=excluded.updated_at`
    ).run(newId(), tenantId, key, content, nowIso());
  },
  async setMode(tenantId, key, mode) { upsertMeta(tenantId, key, "mode=?", [mode === "file" ? "file" : "text"]); },
  async setFile(tenantId, key, sourceId) { upsertMeta(tenantId, key, "file_source_id=?", [sourceId]); },
  async listLinks(tenantId) {
    return (db().prepare(
      `SELECT l.section_key, l.source_id FROM section_sources l JOIN sources s ON s.tenant_id = l.tenant_id AND s.id = l.source_id
       WHERE l.tenant_id = ? ORDER BY l.created_at, l.source_id`
    ).all(tenantId) as Row[])
      .filter((r) => isSectionKey(r.section_key))
      .map((r) => ({ sectionKey: r.section_key as ContextSectionKey, sourceId: r.source_id as string }));
  },
  async link(tenantId, key, sourceId) {
    if (!isSectionKey(key) || !sourceExists(tenantId, sourceId)) return false;
    db().prepare("INSERT OR IGNORE INTO section_sources (tenant_id, section_key, source_id) VALUES (?,?,?)").run(tenantId, key, sourceId);
    return true;
  },
  async unlink(tenantId, key, sourceId) {
    db().prepare("DELETE FROM section_sources WHERE tenant_id=? AND section_key=? AND source_id=?").run(tenantId, key, sourceId);
  },
  async sectionsForSource(tenantId, sourceId) { return sectionsForSource(tenantId, sourceId); },
  async removeSourceReferences(tenantId, sourceId) {
    const keys = sectionsForSource(tenantId, sourceId);
    const d = db();
    d.prepare("DELETE FROM section_sources WHERE tenant_id=? AND source_id=?").run(tenantId, sourceId);
    d.prepare("UPDATE context_sections SET file_source_id=NULL, mode='text', updated_at=? WHERE tenant_id=? AND file_source_id=?").run(nowIso(), tenantId, sourceId);
    return keys;
  },
};

const mapSource = (r: Row): Source => ({
  id: r.id as string, tenantId: r.tenant_id as string, kind: r.kind as SourceKind, title: r.title as string,
  url: (r.url as string) ?? null, filePath: (r.file_path as string) ?? null, status: r.status as SourceStatus,
  error: (r.error as string) ?? null, lastSyncedAt: (r.last_synced_at as string) ?? null, createdAt: r.created_at as string,
});
function getSource(tenantId: string, id: string): Source | null {
  const r = db().prepare("SELECT * FROM sources WHERE tenant_id = ? AND id = ?").get(tenantId, id) as Row | undefined;
  return r ? mapSource(r) : null;
}

export const sources: SourcesRepo = {
  async list(tenantId) {
    return (db().prepare("SELECT * FROM sources WHERE tenant_id = ? ORDER BY created_at DESC").all(tenantId) as Row[]).map(mapSource);
  },
  async get(tenantId, id) { return getSource(tenantId, id); },
  async getText(tenantId, id): Promise<SourceText | null> {
    const r = db().prepare("SELECT id, kind, title, url, file_path, status, error, content_text FROM sources WHERE tenant_id=? AND id=?").get(tenantId, id) as Row | undefined;
    if (!r) return null;
    return {
      id: r.id as string, kind: r.kind as SourceKind, title: r.title as string, url: (r.url as string) ?? null,
      filePath: (r.file_path as string) ?? null, status: r.status as SourceStatus, error: (r.error as string) ?? null,
      text: String(r.content_text ?? ""),
    };
  },
  async exists(tenantId, id) { return sourceExists(tenantId, id); },
  async create(tenantId, s) {
    const id = newId();
    db().prepare("INSERT INTO sources (id, tenant_id, kind, title, url, file_path) VALUES (?,?,?,?,?,?)")
      .run(id, tenantId, s.kind, s.title, s.url ?? null, s.filePath ?? null);
    return getSource(tenantId, id)!;
  },
  async updateStatus(tenantId, id, status, error, contentText) {
    db().prepare(
      "UPDATE sources SET status=?, error=?, content_text=COALESCE(?, content_text), last_synced_at=? WHERE tenant_id=? AND id=?"
    ).run(status, error ?? null, contentText ?? null, nowIso(), tenantId, id);
  },
  async delete(tenantId, id) {
    const d = db();
    d.prepare("DELETE FROM chunks WHERE tenant_id = ? AND source_id = ?").run(tenantId, id);
    d.prepare("DELETE FROM sources WHERE tenant_id = ? AND id = ?").run(tenantId, id);
  },
};

export const chunks: ChunksRepo = {
  async list(tenantId) {
    return (db().prepare("SELECT * FROM chunks WHERE tenant_id = ?").all(tenantId) as Row[]).map((r) => ({
      id: r.id as string, tenantId: r.tenant_id as string, sourceId: (r.source_id as string) ?? null,
      sectionKey: (r.section_key as string) ?? null, title: r.title as string, text: r.text as string,
    }));
  },
  async replace(tenantId, owner, list) {
    const d = db();
    if (owner.sourceId) d.prepare("DELETE FROM chunks WHERE tenant_id=? AND source_id=?").run(tenantId, owner.sourceId);
    if (owner.sectionKey) d.prepare("DELETE FROM chunks WHERE tenant_id=? AND section_key=?").run(tenantId, owner.sectionKey);
    const ins = d.prepare("INSERT INTO chunks (id, tenant_id, source_id, section_key, title, text) VALUES (?,?,?,?,?,?)");
    for (const c of list) ins.run(newId(), tenantId, owner.sourceId ?? null, owner.sectionKey ?? null, c.title ?? "", c.text);
  },
  async replaceSection(tenantId, key, list) {
    const d = db();
    d.prepare("DELETE FROM chunks WHERE tenant_id=? AND section_key=?").run(tenantId, key);
    const ins = d.prepare("INSERT INTO chunks (id, tenant_id, source_id, section_key, title, text) VALUES (?,?,?,?,?,?)");
    for (const c of list) ins.run(newId(), tenantId, c.sourceId, key, c.title, c.text);
  },
  async deleteGeneralForSource(tenantId, sourceId) {
    db().prepare("DELETE FROM chunks WHERE tenant_id=? AND source_id=? AND section_key IS NULL").run(tenantId, sourceId);
  },
};
