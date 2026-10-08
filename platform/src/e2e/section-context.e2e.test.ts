// Context sections: "Usar un archivo" (file replaces typed text) + "Complementar con fuentes de datos" (linked sources).
import { DATA_DIR, ROOT } from "./setup";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("./mocks")).headersMock());
vi.mock("next/cache", async () => (await import("./mocks")).cacheMock());

import { POST as sectionFilePOST } from "@/app/api/context/section-file/route";
import { removeSectionFileAction, saveContextAction, setSectionSourceAction } from "@/app/(app)/context/actions";
import { deleteSourceAction } from "@/app/(app)/sources/actions";
import { runMigrations, UPLOAD_DIR } from "@/lib/db";
import { createSource, getSource, listChunks, listSources, replaceChunks, saveContextSection, updateSourceStatus } from "@/lib/store";
import { chunkText, indexSource, reindexSection } from "@/lib/context";
import {
  ALWAYS_ON_CAP, getEffectiveSectionContent, getSectionMeta, isSectionFilled, listSectionLinks, sectionFileSourceIds, TRUNCATION_NOTE,
} from "@/lib/context/section-repo";
import { resolveUploadPath } from "@/lib/context/upload-path";
import { handleInbound } from "@/lib/engine";
import { CONTEXT_SECTION_KEYS, type ContextSectionKey } from "@/lib/types";
import { asUser, faithfulLLM, newTenant, seedContext, type TestTenant } from "./helpers";

/** The Context screen always posts ALL sections. */
const all = (over: Partial<Record<ContextSectionKey, string>>) =>
  Object.fromEntries(CONTEXT_SECTION_KEYS.map((k) => [k, over[k] ?? ""])) as Record<ContextSectionKey, string>;
const ORIGIN = "https://inbox.test";
const URL_ = `${ORIGIN}/api/context/section-file`;

async function uploadReq(section: string, name: string, content: string | Uint8Array, o: { type?: string; origin?: string; contentLength?: string } = {}) {
  const fd = new FormData();
  fd.append("section", section);
  fd.append("file", new File([content as BlobPart], name, { type: o.type ?? "text/plain" }));
  const tmp = new Request(URL_, { method: "POST", body: fd });
  const body = await tmp.arrayBuffer();
  const origin = o.origin ?? ORIGIN;
  return new Request(URL_, {
    method: "POST", body,
    headers: {
      "content-type": tmp.headers.get("content-type")!, "content-length": o.contentLength ?? String(body.byteLength),
      origin, "sec-fetch-site": origin === ORIGIN ? "same-origin" : "cross-site",
    },
  });
}
async function upload(section: string, name: string, content: string, type = "text/plain") {
  const res = await sectionFilePOST(await uploadReq(section, name, content, { type }));
  return { status: res.status, body: (await res.json()) as { ok?: boolean; id?: string; indexed?: boolean; error?: string; preview?: string; name?: string; size?: number } };
}
const sectionChunks = (tenantId: string, key: string) => listChunks(tenantId).filter((c) => c.sectionKey === key);

/** An indexed link source, the same way the demo seed / Sources screen leaves it (general chunks). */
function indexedLink(tenantId: string, title: string, text: string) {
  const s = createSource(tenantId, { kind: "link", title, url: `https://example.com/${encodeURIComponent(title)}` });
  updateSourceStatus(tenantId, s.id, "indexed", undefined, text);
  replaceChunks(tenantId, { sourceId: s.id }, chunkText(text, title));
  return s.id;
}

let T: TestTenant;
let n = 0;
beforeEach(() => { T = newTenant(); asUser(T); });

describe("migration", () => {
  it("is additive and idempotent on a DB created by an older build", () => {
    const file = path.join(ROOT, `old-${Date.now()}.db`);
    const db = new DatabaseSync(file);
    db.exec(`CREATE TABLE context_sections (
      id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, key TEXT NOT NULL, content TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT (datetime('now')), UNIQUE(tenant_id, key));
      INSERT INTO context_sections (id, tenant_id, key, content) VALUES ('1', 'old', 'warranty', 'Garantía de 1 año');`);
    runMigrations(db);
    runMigrations(db); // second run is a no-op
    const cols = (db.prepare("PRAGMA table_info(context_sections)").all() as { name: string }[]).map((c) => c.name);
    expect(cols.filter((c) => c === "mode")).toHaveLength(1);
    expect(cols).toContain("file_source_id");
    const row = db.prepare("SELECT content, mode, file_source_id FROM context_sections WHERE key='warranty'").get() as Record<string, unknown>;
    expect(row).toEqual({ content: "Garantía de 1 año", mode: "text", file_source_id: null });
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='section_sources'").get()).toBeTruthy();
    db.close();
  });
});

describe("Usar un archivo", () => {
  it("file mode replaces the typed text (effective content + retrieval chunks); switching back restores the text", async () => {
    await saveContextAction({ sections: all({ warranty: "Texto escrito: garantía de 1 año." }) });
    const up = await upload("warranty", "garantia.txt", "Archivo oficial: la garantía es de 2 años contra defectos de fábrica.");
    expect(up.status).toBe(200);
    expect(up.body).toMatchObject({ ok: true, indexed: true, name: "garantia.txt" });
    expect(up.body.preview).toMatch(/^Archivo oficial/);
    const fileId = up.body.id!;

    let eff = getEffectiveSectionContent(T.tenantId, "warranty");
    expect(eff).toMatchObject({ mode: "file", using: "file", fileFailed: false });
    expect(eff.text).toMatch(/2 años/);
    expect(eff.typed).toBe("Texto escrito: garantía de 1 año."); // kept as a draft
    let chunks = sectionChunks(T.tenantId, "warranty");
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((c) => /2 años/.test(c.text) && c.sourceId === fileId)).toBe(true);
    expect(listChunks(T.tenantId).some((c) => /1 año\./.test(c.text))).toBe(false);
    // the section file is not a general source (no section-less chunks, hidden from the Sources list)
    expect(listChunks(T.tenantId).some((c) => c.sourceId === fileId && c.sectionKey === null)).toBe(false);
    expect(sectionFileSourceIds(T.tenantId).has(fileId)).toBe(true);

    // back to "Escribir"
    await saveContextAction({ sections: all({ warranty: "Texto escrito: garantía de 1 año." }), modes: { warranty: "text" } });
    eff = getEffectiveSectionContent(T.tenantId, "warranty");
    expect(eff).toMatchObject({ mode: "text", using: "text" });
    expect(eff.text).toBe("Texto escrito: garantía de 1 año.");
    chunks = sectionChunks(T.tenantId, "warranty");
    expect(chunks.every((c) => /1 año/.test(c.text) && c.sourceId === null)).toBe(true);
    expect(listChunks(T.tenantId).some((c) => /2 años/.test(c.text))).toBe(false);
    expect(getSectionMeta(T.tenantId, "warranty").fileSourceId).toBe(fileId); // file kept, just not used

    // and to the file again without re-uploading
    expect((await saveContextAction({ sections: all({ warranty: "Texto escrito: garantía de 1 año." }), modes: { warranty: "file" } })).changed).toBe(1);
    expect(getEffectiveSectionContent(T.tenantId, "warranty").using).toBe("file");
  });

  it("Reemplazar deletes the previous file; Quitar goes back to the typed text", async () => {
    await saveContextAction({ sections: all({ faq: "¿Lavavajillas? Sí." }) });
    const a = await upload("faq", "faq1.txt", "Primera versión del archivo de preguntas.");
    const oldPath = resolveUploadPath(T.tenantId, getSource(T.tenantId, a.body.id!)!.filePath!)!;
    expect(fs.existsSync(oldPath)).toBe(true);
    const b = await upload("faq", "faq2.md", "Segunda versión: el vaso es de vidrio.", "text/markdown");
    expect(getSource(T.tenantId, a.body.id!)).toBeNull();
    expect(fs.existsSync(oldPath)).toBe(false);
    expect(sectionChunks(T.tenantId, "faq").every((c) => c.sourceId === b.body.id && /Segunda/.test(c.text))).toBe(true);

    expect(await removeSectionFileAction({ key: "faq" })).toEqual({ ok: true });
    expect(getSource(T.tenantId, b.body.id!)).toBeNull();
    expect(getSectionMeta(T.tenantId, "faq")).toEqual({ mode: "text", fileSourceId: null });
    expect(sectionChunks(T.tenantId, "faq").map((c) => c.text).join(" ")).toMatch(/Lavavajillas/);
    expect(listChunks(T.tenantId).some((c) => c.sourceId === b.body.id)).toBe(false);
  });

  it("a file that fails to index falls back to the typed text and is flagged", async () => {
    await saveContextAction({ sections: all({ shipping_returns: "Envíos en 3 a 5 días." }) });
    const up = await upload("shipping_returns", "vacio.txt", "   \n   ");
    expect(up.status).toBe(200);
    expect(up.body).toMatchObject({ ok: true, indexed: false, error: "empty", preview: "" });
    const eff = getEffectiveSectionContent(T.tenantId, "shipping_returns");
    expect(eff).toMatchObject({ mode: "file", using: "text", fileFailed: true });
    expect(eff.file?.status).toBe("error");
    expect(eff.text).toBe("Envíos en 3 a 5 días.");
    expect(sectionChunks(T.tenantId, "shipping_returns").map((c) => c.text).join(" ")).toMatch(/3 a 5 días/);
  });

  it("the completeness meter counts a section filled by a file only", async () => {
    expect(isSectionFilled(getEffectiveSectionContent(T.tenantId, "products"), 21)).toBe(false);
    await upload("products", "productos.csv", "modelo,potencia\nFreidora 5L,1700 W\nLicuadora,1200 W", "text/csv");
    expect(getEffectiveSectionContent(T.tenantId, "products").typed).toBe("");
    expect(isSectionFilled(getEffectiveSectionContent(T.tenantId, "products"), 21)).toBe(true);
  });
});

describe("upload route guardrails", () => {
  it("rejects a bad type, fake magic bytes, oversize, cross-origin, unknown section and no session", async () => {
    const bad = async (r: Request) => { const res = await sectionFilePOST(r); return { status: res.status, body: await res.json() }; };
    expect(await bad(await uploadReq("faq", "virus.exe", "MZ...", { type: "application/octet-stream" }))).toMatchObject({ status: 400, body: { error: "bad_type" } });
    expect(await bad(await uploadReq("faq", "fake.pdf", "esto no es un pdf", { type: "application/pdf" }))).toMatchObject({ status: 400, body: { error: "bad_type" } });
    expect(await bad(await uploadReq("faq", "bin.txt", new Uint8Array([65, 0, 66])))).toMatchObject({ status: 400, body: { error: "bad_type" } });
    expect(await bad(await uploadReq("faq", "big.txt", "x", { contentLength: String(11 * 1024 * 1024) }))).toMatchObject({ status: 413, body: { error: "too_big" } });
    expect((await bad(await uploadReq("faq", "ok.txt", "hola", { origin: "https://evil.example" }))).status).toBe(403);
    expect(await bad(await uploadReq("nope", "ok.txt", "hola"))).toMatchObject({ status: 400, body: { error: "bad_section" } });
    asUser(null);
    expect((await bad(await uploadReq("faq", "ok.txt", "hola"))).status).toBe(401);
    asUser(T);
    expect(listSources(T.tenantId)).toHaveLength(0);
    expect(getSectionMeta(T.tenantId, "faq")).toEqual({ mode: "text", fileSourceId: null });
    expect(fs.existsSync(path.join(UPLOAD_DIR, T.tenantId)) ? fs.readdirSync(path.join(UPLOAD_DIR, T.tenantId)) : []).toHaveLength(0);
  });
});

describe("Complementar con fuentes de datos", () => {
  it("linked source chunks carry the sectionKey (and sourceId), go back to general on unlink, and vanish with the source", async () => {
    seedContext(T.tenantId);
    const id = indexedLink(T.tenantId, "Manual freidora", "La canasta de la freidora se lava con agua tibia y jabón neutro.");
    expect(await setSectionSourceAction({ key: "products", sourceId: id, linked: true })).toEqual({ ok: true });
    let mine = listChunks(T.tenantId).filter((c) => c.sourceId === id);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((c) => c.sectionKey === "products")).toBe(true);
    expect(sectionChunks(T.tenantId, "products").some((c) => c.sourceId === null && /Licuadora/.test(`${c.title} ${c.text}`))).toBe(true); // own text kept

    await setSectionSourceAction({ key: "products", sourceId: id, linked: false });
    mine = listChunks(T.tenantId).filter((c) => c.sourceId === id);
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((c) => c.sectionKey === null)).toBe(true);

    await setSectionSourceAction({ key: "products", sourceId: id, linked: true });
    await setSectionSourceAction({ key: "faq", sourceId: id, linked: true });
    expect(new Set(listChunks(T.tenantId).filter((c) => c.sourceId === id).map((c) => c.sectionKey))).toEqual(new Set(["products", "faq"]));
    expect(await deleteSourceAction({ id })).toEqual({ ok: true });
    expect(listChunks(T.tenantId).some((c) => c.sourceId === id)).toBe(false);
    expect(listSectionLinks(T.tenantId)).toEqual([]);
    expect(sectionChunks(T.tenantId, "products").some((c) => /Licuadora/.test(`${c.title} ${c.text}`))).toBe(true);
  });

  it("re-syncing a linked source refreshes that section's chunks", async () => {
    const rel = path.posix.join(T.tenantId, `sync-${++n}.txt`);
    const full = path.join(UPLOAD_DIR, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, "Versión uno del catálogo.");
    const src = createSource(T.tenantId, { kind: "file", title: "catalogo.txt", filePath: rel });
    await indexSource(T.tenantId, src.id);
    await setSectionSourceAction({ key: "products", sourceId: src.id, linked: true });
    expect(sectionChunks(T.tenantId, "products").map((c) => c.text).join(" ")).toMatch(/Versión uno/);
    fs.writeFileSync(full, "Versión dos del catálogo con horno.");
    await indexSource(T.tenantId, src.id);
    const texts = listChunks(T.tenantId).filter((c) => c.sourceId === src.id);
    expect(texts.every((c) => c.sectionKey === "products" && /Versión dos/.test(c.text))).toBe(true);
  });
});

describe("always-on sections reach the engine prompt", () => {
  const ask = async (tenantId: string, text = "¿Cuánto dura la garantía de mis productos?") => {
    const { llm, calls } = faithfulLLM();
    await handleInbound({ tenantId, channel: "whatsapp", externalId: `sec-${++n}`, customerName: "Ana", text, providerMessageId: `sec-msg-${n}` }, { llm });
    expect(calls).toHaveLength(1);
    return calls[0];
  };

  it("a source linked to dos_donts is in the system prompt (not in retrieved sources)", async () => {
    seedContext(T.tenantId);
    const id = indexedLink(T.tenantId, "Reglas de marca", "Nunca menciones a la competencia ZetaCorp.");
    await setSectionSourceAction({ key: "dos_donts", sourceId: id, linked: true });
    const req = await ask(T.tenantId);
    expect(req.system).toMatch(/Nunca prometas descuentos/);
    expect(req.system).toMatch(/ZetaCorp/);
    expect(req.sources.some((s) => s.sourceId === id || s.sectionKey === "dos_donts")).toBe(false);
  });

  it("caps always-on content and marks the truncation", async () => {
    seedContext(T.tenantId);
    const big = `${"Regla larga de escalamiento. ".repeat(1200)}MARCADOR-FINAL`;
    const id = indexedLink(T.tenantId, "Manual de escalamiento", big);
    await setSectionSourceAction({ key: "escalation", sourceId: id, linked: true });
    const eff = getEffectiveSectionContent(T.tenantId, "escalation");
    expect(eff.truncated).toBe(true);
    expect(eff.text.length).toBeLessThanOrEqual(ALWAYS_ON_CAP + TRUNCATION_NOTE.length + 1);
    const req = await ask(T.tenantId);
    expect(req.system).toContain(TRUNCATION_NOTE);
    expect(req.system).not.toMatch(/MARCADOR-FINAL/);
  });

  it("file mode on an always-on section uses the file; a failed file falls back to the typed text", async () => {
    seedContext(T.tenantId);
    await upload("escalation", "escalar.txt", "ARCHIVO-ESCALA: pasar con una persona si piden factura.");
    let req = await ask(T.tenantId);
    expect(req.system).toMatch(/ARCHIVO-ESCALA/);
    expect(req.system).not.toMatch(/Quejas graves/);

    await upload("dos_donts", "reglas.txt", "  \n ");
    req = await ask(T.tenantId);
    expect(getEffectiveSectionContent(T.tenantId, "dos_donts").fileFailed).toBe(true);
    expect(req.system).toMatch(/Nunca prometas descuentos/);
  });
});

describe("tenant isolation", () => {
  it("another tenant cannot link, delete or see a tenant's sources and section files", async () => {
    const A = T;
    seedContext(A.tenantId);
    const srcA = indexedLink(A.tenantId, "Fuente A", "Información privada de la marca A.");
    await setSectionSourceAction({ key: "faq", sourceId: srcA, linked: true });
    const fileA = await upload("warranty", "garantia-a.txt", "Garantía secreta de A: 5 años.");

    const B = newTenant("Otra marca");
    asUser(B);
    expect(await setSectionSourceAction({ key: "faq", sourceId: srcA, linked: true })).toEqual({ ok: false, error: "not_found" });
    expect(await deleteSourceAction({ id: srcA })).toEqual({ ok: false, error: "not_found" });
    expect(await removeSectionFileAction({ key: "warranty" })).toEqual({ ok: true }); // B has no file: no-op for A
    saveContextSection(B.tenantId, "warranty", "Garantía de B");
    reindexSection(B.tenantId, "warranty");
    expect(getEffectiveSectionContent(B.tenantId, "warranty").text).toBe("Garantía de B");
    expect(getEffectiveSectionContent(B.tenantId, "faq").linked).toEqual([]);
    expect(listChunks(B.tenantId).some((c) => /privada|secreta/.test(c.text))).toBe(false);

    // A is untouched
    expect(listSectionLinks(A.tenantId)).toEqual([{ sectionKey: "faq", sourceId: srcA }]);
    expect(getEffectiveSectionContent(A.tenantId, "warranty")).toMatchObject({ using: "file" });
    expect(getEffectiveSectionContent(A.tenantId, "warranty").file?.id).toBe(fileA.body.id);
    expect(fs.existsSync(DATA_DIR)).toBe(true);
  });
});
