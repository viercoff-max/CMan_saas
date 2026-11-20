// Supabase Storage FileStore (DATA_BACKEND=supabase). SERVER ONLY: uses the service-role client from
// src/lib/data/supabase/client.ts, which bypasses the storage.objects RLS policies, so tenant isolation is enforced
// here: every object path is "<tenantId>/<key>" built by objectPath() (validated tenant folder + server-built key).
// Buckets (init migration): "tenant-files" private, 10 MB, pdf/txt/md/csv/html/docx; "brand-assets" public, 2 MB,
// png/jpeg/webp (no SVG). Error messages carry only the bucket and operation, never the path or Storage details.
// NOTE: relative imports only (CLI scripts load src/lib with Node's type stripping).
import { createServiceClient, type Db, type StorageError, type StorageObject } from "../data/supabase/client";
import { objectPath, safeKey, safePrefix, tenantFolder } from "./paths";
import { StorageBackendError, type FileBucket, type FileInfo, type FileStore } from "./types";

type StorageDb = Pick<Db, "storage">;

const isNotFound = (e: StorageError) => e.statusCode === "404" || e.status === 404 || /not.?found/i.test(e.message ?? "");
const fail = (bucket: string, op: string, e: StorageError) =>
  new StorageBackendError(`Supabase Storage ${op} failed (${bucket}${e.statusCode ? `, ${e.statusCode}` : ""}).`);

const info = (key: string, o: StorageObject): FileInfo => ({
  key, size: Number(o.metadata?.size ?? 0), updatedAt: o.updated_at ?? o.created_at ?? null,
});

export function createSupabaseFileStore(bucket: FileBucket, db: StorageDb = createServiceClient()): FileStore {
  const b = () => db.storage.from(bucket);
  async function find(tenantId: string, key: string): Promise<FileInfo | null> {
    const k = safeKey(key);
    const slash = k.lastIndexOf("/");
    const dir = slash < 0 ? tenantFolder(tenantId) : `${tenantFolder(tenantId)}/${k.slice(0, slash)}`;
    const name = k.slice(slash + 1);
    const { data, error } = await b().list(dir, { limit: 100, search: name });
    if (error) throw fail(bucket, "stat", error);
    const o = (data ?? []).find((x) => x.name === name && x.id !== null);
    return o ? info(k, o) : null;
  }
  return {
    backend: "supabase",
    bucket,
    async put(tenantId, key, bytes, contentType) {
      const p = objectPath(tenantId, key);
      const { error } = await b().upload(p, bytes, { contentType, upsert: true, cacheControl: bucket === "brand-assets" ? "31536000" : "3600" });
      if (error) throw fail(bucket, "upload", error);
      return p;
    },
    async get(tenantId, key) {
      const { data, error } = await b().download(objectPath(tenantId, key));
      if (error) { if (isNotFound(error)) return null; throw fail(bucket, "download", error); }
      return data ? new Uint8Array(await data.arrayBuffer()) : null;
    },
    async remove(tenantId, key) {
      const { error } = await b().remove([objectPath(tenantId, key)]);
      if (error && !isNotFound(error)) throw fail(bucket, "remove", error);
    },
    stat: find,
    async list(tenantId, prefix) {
      const pre = safePrefix(prefix);
      const dir = pre ? `${tenantFolder(tenantId)}/${pre}` : tenantFolder(tenantId);
      const { data, error } = await b().list(dir, { limit: 1000, sortBy: { column: "name", order: "asc" } });
      if (error) throw fail(bucket, "list", error);
      const out: FileInfo[] = [];
      for (const o of data ?? []) {
        if (o.id === null) continue; // a folder
        const key = pre ? `${pre}/${o.name}` : o.name;
        try { safeKey(key); } catch { continue; }
        out.push(info(key, o));
      }
      return out;
    },
    publicUrl(tenantId, key) {
      if (bucket !== "brand-assets") throw new Error("publicUrl is only available for the brand-assets bucket.");
      return b().getPublicUrl(objectPath(tenantId, key)).data.publicUrl;
    },
  };
}
