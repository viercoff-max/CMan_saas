// FileStore (stage 4): path safety, the local and Supabase backends (Supabase on the in-memory fake with the real
// bucket rules), cross-tenant negatives, logo validation, the outbox in Supabase mode and the full Supabase-mode
// upload -> index -> delete flow of a file source.
import "../../channels/__tests__/env-secrets";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FakeSupabase } from "../../data/__tests__/supabase-fake";
import { createSupabaseStore } from "../../data/supabase";
import type { DataStore } from "../../data/types";
import { __setFileStoreForTests, getFileStore, keyFromStored, objectPath, safeKey, sanitizeName, StoragePathError, storageBackend, uploadKey } from "..";
import { createLocalFileStore, localPath } from "../local";
import { logoUrl, removeLogo, sniffImage, uploadLogo, LOGO_MAX_BYTES } from "../logo";
import { deleteOutboxFor, purgeOutboxBefore, writeOutboxFile } from "../outbox";
import { createSupabaseFileStore } from "../supabase";
import { StorageBackendError, type FileStore } from "../types";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
const text = (s: string) => new TextEncoder().encode(s);
const UUID_PATH = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\//;

describe("paths", () => {
  it("keys are tenant-relative, server-built and traversal-proof", () => {
    for (const bad of ["", "..", "../x", "a/../b", "/abs", "a//b", ".hidden", "a/.env", "a\\b", "a b", "x".repeat(121), "a/b/c/d/e"])
      expect(() => safeKey(bad), bad).toThrow(StoragePathError);
    expect(safeKey("outbox/2026-a.txt")).toBe("outbox/2026-a.txt");
    expect(() => objectPath("../t", "a.pdf")).toThrow(StoragePathError);
    expect(() => objectPath("t/x", "a.pdf")).toThrow(StoragePathError);
    const T = randomUUID();
    expect(objectPath(T.toUpperCase(), "a.pdf")).toBe(`${T}/a.pdf`);
    expect(uploadKey("../../etc/passwd")).toMatch(/^[0-9a-f-]{36}-passwd$/);
    expect(sanitizeName("Catálogo 2026 (final).PDF")).toBe("Catalogo_2026_final_.PDF");
    expect(sanitizeName("...")).toBe("file");
  });

  it("keyFromStored is the cross-tenant guard for persisted paths", () => {
    const A = randomUUID(), B = randomUUID();
    expect(keyFromStored(A, `${A}/x.pdf`)).toBe("x.pdf");
    expect(keyFromStored(A, `${A.toUpperCase()}/x.pdf`)).toBe("x.pdf");
    expect(keyFromStored(A, `${B}/x.pdf`)).toBeNull();
    expect(keyFromStored(A, `${A}/../${B}/x.pdf`)).toBeNull();
    expect(keyFromStored(A, "demo/guia.pdf")).toBeNull();
    expect(keyFromStored(A, null)).toBeNull();
    expect(keyFromStored("chefman", "chefman/a-b.pdf")).toBe("a-b.pdf"); // SQLite-era ids keep working
    expect(keyFromStored("chefman", "chefmanx/a.pdf")).toBeNull();
  });

  it("the backend follows DATA_BACKEND", () => {
    expect(storageBackend({})).toBe("local");
    expect(storageBackend({ DATA_BACKEND: "sqlite" })).toBe("local");
    expect(storageBackend({ DATA_BACKEND: " Supabase " })).toBe("supabase");
  });
});

/** Behaviour both backends share. */
function fileStoreContract(name: string, make: () => FileStore, tenant: () => string) {
  describe(`FileStore contract [${name}]`, () => {
    let s: FileStore; let A: string; let B: string;
    beforeEach(() => { s = make(); A = tenant(); B = tenant(); });

    it("put / get / stat / list / remove", async () => {
      const p = await s.put(A, "doc-1.txt", text("hola"), "text/plain");
      expect(p).toBe(`${A.toLowerCase()}/doc-1.txt`);
      expect(new TextDecoder().decode((await s.get(A, "doc-1.txt"))!)).toBe("hola");
      expect(await s.stat(A, "doc-1.txt")).toMatchObject({ key: "doc-1.txt", size: 4 });
      await s.put(A, "outbox/b.txt", text("b"), "text/plain");
      await s.put(A, "outbox/a.txt", text("aa"), "text/plain");
      expect((await s.list(A, "outbox")).map((f) => [f.key, f.size])).toEqual([["outbox/a.txt", 2], ["outbox/b.txt", 1]]);
      expect((await s.list(A, "")).map((f) => f.key)).toEqual(["doc-1.txt"]); // folders are skipped
      await s.put(A, "doc-1.txt", text("v2"), "text/plain"); // replace
      expect(new TextDecoder().decode((await s.get(A, "doc-1.txt"))!)).toBe("v2");
      await s.remove(A, "doc-1.txt");
      await s.remove(A, "doc-1.txt"); // idempotent
      expect(await s.get(A, "doc-1.txt")).toBeNull();
      expect(await s.stat(A, "doc-1.txt")).toBeNull();
      expect(await s.list(A, "nothing-here")).toEqual([]);
    });

    it("tenant B can never read, list or delete tenant A's files", async () => {
      await s.put(A, "secret.txt", text("de A"), "text/plain");
      expect(await s.get(B, "secret.txt")).toBeNull();
      expect(await s.stat(B, "secret.txt")).toBeNull();
      expect(await s.list(B, "")).toEqual([]);
      await s.remove(B, "secret.txt");
      expect(await s.get(A, "secret.txt")).not.toBeNull();
      for (const k of [`../${A}/secret.txt`, `${A}/../${A}/secret.txt`, "..", "./secret.txt"])
        await expect(s.get(B, k), k).rejects.toBeInstanceOf(StoragePathError);
      await expect(s.put(B, "../x.txt", text("x"), "text/plain")).rejects.toBeInstanceOf(StoragePathError);
      await expect(s.get("../" + A, "secret.txt")).rejects.toBeInstanceOf(StoragePathError);
    });

    it("publicUrl only for the brand-assets bucket", () => {
      expect(() => s.publicUrl(A, "doc.txt")).toThrow(/brand-assets/);
    });
  });
}

const tmpRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), "filestore-"));
fileStoreContract("local", () => createLocalFileStore("tenant-files", tmpRoot()), () => `t-${randomUUID()}`);
const fake = new FakeSupabase();
fileStoreContract("supabase (fake)", () => createSupabaseFileStore("tenant-files", fake), () => randomUUID());

describe("local backend specifics", () => {
  it("keeps today's layout: <root>/<tenantId>/<key>, and never resolves outside the tenant folder", async () => {
    const root = tmpRoot();
    const s = createLocalFileStore("tenant-files", root);
    await s.put("chefman", "abc-a.pdf", text("%PDF-1.4"), "application/pdf");
    expect(fs.existsSync(path.join(root, "chefman", "abc-a.pdf"))).toBe(true);
    expect(localPath(root, "chefman", "outbox/x.txt")).toBe(path.join(path.resolve(root), "chefman", "outbox", "x.txt"));
    expect(() => localPath(root, "chefman", "../other/x.txt")).toThrow(StoragePathError);
    const b = createLocalFileStore("brand-assets", root);
    expect(b.publicUrl("chefman", "logo-x.png")).toBe("/api/brand-assets/chefman/logo-x.png");
  });
});

describe("supabase backend specifics", () => {
  it("every object path is '<tenant uuid>/...', bucket rules apply, errors carry no paths", async () => {
    const f = new FakeSupabase();
    const s = createSupabaseFileStore("tenant-files", f);
    const T = randomUUID();
    await s.put(T, "abc-catalogo.pdf", text("%PDF-1.4"), "application/pdf");
    expect([...f.storageFake.objects["tenant-files"].keys()]).toEqual([`${T}/abc-catalogo.pdf`]);
    expect(f.storageFake.objects["tenant-files"].get(`${T}/abc-catalogo.pdf`)?.contentType).toBe("application/pdf");
    // The private bucket refuses image/svg+xml and anything not on its list.
    const e = await s.put(T, "x.svg", SVG, "image/svg+xml").catch((x: unknown) => x as Error);
    expect(e).toBeInstanceOf(StorageBackendError);
    expect((e as Error).message).not.toContain(T);
    expect((e as Error).message).not.toContain("x.svg");
    f.storageFake.failNext({ message: "boom", statusCode: "500" });
    await expect(s.get(T, "abc-catalogo.pdf")).rejects.toBeInstanceOf(StorageBackendError);
    expect(f.storageFake.calls.every((c) => c.paths.every((p) => UUID_PATH.test(p) || /^[0-9a-f-]{36}(\/|$)/.test(p)))).toBe(true);
  });

  it("brand-assets: public URL of the object, 2 MB limit", async () => {
    const f = new FakeSupabase();
    const s = createSupabaseFileStore("brand-assets", f);
    const T = randomUUID();
    const p = await s.put(T, "logo-1.png", PNG, "image/png");
    expect(p).toBe(`${T}/logo-1.png`);
    expect(s.publicUrl(T, "logo-1.png")).toBe(`https://fake.supabase.test/storage/v1/object/public/brand-assets/${T}/logo-1.png`);
    await expect(s.put(T, "big.png", new Uint8Array(LOGO_MAX_BYTES + 1), "image/png")).rejects.toBeInstanceOf(StorageBackendError);
  });
});

describe("uploadLogo", () => {
  it("accepts png / jpeg / webp whose bytes match the declared type", async () => {
    const T = `t-${randomUUID()}`;
    for (const [bytes, type, ext] of [[PNG, "image/png", "png"], [JPG, "image/jpg", "jpg"], [WEBP, "image/webp", "webp"]] as const) {
      const r = await uploadLogo(T, bytes, type);
      expect(r.ok, type).toBe(true);
      if (!r.ok) continue;
      expect(r.path).toMatch(new RegExp(`^${T}/logo-[0-9a-f-]{36}\\.${ext}$`));
      expect(r.url).toBe(`/api/brand-assets/${r.path}`);
      expect(logoUrl(T, r.path)).toBe(r.url);
      expect(await getFileStore("brand-assets").get(T, r.path.slice(T.length + 1))).toEqual(bytes);
      await removeLogo(T, r.path);
      expect(await getFileStore("brand-assets").get(T, r.path.slice(T.length + 1))).toBeNull();
    }
  });

  it("rejects SVG, mismatched types, empty and oversized files", async () => {
    const T = `t-${randomUUID()}`;
    expect(await uploadLogo(T, SVG, "image/svg+xml")).toEqual({ ok: false, error: "bad_type" });
    expect(await uploadLogo(T, SVG, "image/png")).toEqual({ ok: false, error: "bad_type" }); // renamed SVG
    expect(await uploadLogo(T, PNG, "image/jpeg")).toEqual({ ok: false, error: "bad_type" });
    expect(await uploadLogo(T, PNG, "")).toEqual({ ok: false, error: "bad_type" });
    expect(await uploadLogo(T, text("GIF89a...."), "image/gif")).toEqual({ ok: false, error: "bad_type" });
    expect(await uploadLogo(T, new Uint8Array(), "image/png")).toEqual({ ok: false, error: "empty" });
    const big = new Uint8Array(LOGO_MAX_BYTES + 1); big.set(PNG);
    expect(await uploadLogo(T, big, "image/png")).toEqual({ ok: false, error: "too_big" });
    expect(sniffImage(SVG)).toBeNull();
    expect(logoUrl(T, `t-other/logo-${randomUUID()}.png`)).toBeNull(); // another tenant's path
  });
});

describe("Supabase mode end to end (fake project)", () => {
  let f: FakeSupabase;
  let store: DataStore;
  const g = globalThis as { __dataStore?: DataStore };
  let saved: DataStore | undefined;

  beforeEach(() => {
    f = new FakeSupabase();
    store = createSupabaseStore(f);
    saved = g.__dataStore;
    g.__dataStore = store;
    process.env.DATA_BACKEND = "supabase";
    __setFileStoreForTests("supabase", "tenant-files", createSupabaseFileStore("tenant-files", f));
    __setFileStoreForTests("supabase", "brand-assets", createSupabaseFileStore("brand-assets", f));
  });
  afterEach(() => {
    delete process.env.DATA_BACKEND;
    g.__dataStore = saved;
    __setFileStoreForTests("supabase", "tenant-files", null);
    __setFileStoreForTests("supabase", "brand-assets", null);
  });

  it("upload -> file source row (storage_path) -> index -> delete removes the object", async () => {
    const { storeUpload } = await import("../../context/upload");
    const { indexSource } = await import("../../context/index-source");
    const { deleteSourceAndLinks } = await import("../../context/section-index");
    const T = await store.tenants.ensure(`up-${randomUUID()}`, "Uploads");
    const other = await store.tenants.ensure(`up-${randomUUID()}`, "Other");
    const rel = await storeUpload(T, "precios.txt", text("La garantía dura 2 años."));
    expect(rel).toMatch(new RegExp(`^${T}/[0-9a-f-]{36}-precios\\.txt$`));
    expect(f.storageFake.objects["tenant-files"].get(rel!)?.contentType).toBe("text/plain");
    const src = await store.sources.create(T, { kind: "file", title: "precios.txt", filePath: rel! });
    expect(await indexSource(T, src.id)).toMatchObject({ ok: true });
    expect((await store.sources.getText(T, src.id))?.text).toContain("garantía");
    // A row of another tenant can never point at T's object.
    await expect(store.sources.create(other, { kind: "file", title: "x", filePath: rel! })).rejects.toThrow(/filePath/);
    expect(await deleteSourceAndLinks(T, src.id)).toBe(true);
    expect(f.storageFake.objects["tenant-files"].has(rel!)).toBe(false);
  });

  it("indexing a file source whose object is missing reports file_missing", async () => {
    const { indexSource } = await import("../../context/index-source");
    const T = await store.tenants.ensure(`miss-${randomUUID()}`, "Missing");
    const src = await store.sources.create(T, { kind: "file", title: "x.txt", filePath: `${T}/${randomUUID()}-x.txt` });
    expect(await indexSource(T, src.id)).toMatchObject({ ok: false, error: "file_missing" });
  });

  it("logos go to the public brand-assets bucket with the Supabase public URL", async () => {
    const T = randomUUID();
    const r = await uploadLogo(T, PNG, "image/png");
    expect(r.ok && r.url).toMatch(new RegExp(`^https://fake\\.supabase\\.test/storage/v1/object/public/brand-assets/${T}/logo-`));
    expect([...f.storageFake.objects["brand-assets"].keys()]).toHaveLength(1);
  });

  it("outbox files live in '<tenant>/outbox/' and are deleted / purged per tenant only", async () => {
    const A = randomUUID(), B = randomUUID(), convA = randomUUID(), convB = randomUUID();
    const nameA = await writeOutboxFile(A, convA, `Abrir conversación ${convA}`);
    await writeOutboxFile(B, convB, `Abrir conversación ${convB} cliente psid-123456`);
    const oldName = await writeOutboxFile(A, randomUUID(), "viejo", new Date("2000-01-01T00:00:00Z"));
    expect(f.storageFake.objects["tenant-files"].has(`${A}/outbox/${nameA}`)).toBe(true);
    expect(await deleteOutboxFor(A, [convB], ["psid-123456"])).toBe(0); // B's file is not reachable from A
    expect(await deleteOutboxFor(B, [], ["psid-123456"])).toBe(1); // matched by content
    expect(await deleteOutboxFor(A, [convA])).toBe(1); // matched by name
    // Purge by last write: make the "old" object old, then purge.
    f.storageFake.objects["tenant-files"].get(`${A}/outbox/${oldName}`)!.updatedAt = "2000-01-01T00:00:00.000Z";
    expect(await purgeOutboxBefore([A, B], Date.parse("2001-01-01T00:00:00Z"))).toBe(1);
    expect([...f.storageFake.objects["tenant-files"].keys()]).toEqual([]);
  });
});
