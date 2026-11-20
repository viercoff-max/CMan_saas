// Local-disk FileStore (DATA_BACKEND=sqlite): today's layout DATA_DIR/uploads/<tenantId>/<key>, plus
// DATA_DIR/brand-assets/<tenantId>/<key> for logos. Every resolved path is checked to stay inside the tenant folder.
// NOTE: relative imports only (CLI scripts load src/lib with Node's type stripping).
import fs from "node:fs/promises";
import path from "node:path";
import { safeKey, safePrefix, tenantFolder, objectPath, StoragePathError } from "./paths";
import type { FileBucket, FileInfo, FileStore } from "./types";

/** Absolute path of "<root>/<tenant>/<key>", refusing anything that escapes "<root>/<tenant>/". */
export function localPath(root: string, tenantId: string, key: string): string {
  const base = path.resolve(root, tenantFolder(tenantId));
  const full = path.resolve(base, ...safeKey(key).split("/"));
  if (!full.startsWith(base + path.sep)) throw new StoragePathError();
  return full;
}

const isMissing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === "ENOENT" || (e as NodeJS.ErrnoException)?.code === "ENOTDIR";

export function createLocalFileStore(bucket: FileBucket, root: string): FileStore {
  return {
    backend: "local",
    bucket,
    async put(tenantId, key, bytes) {
      const full = localPath(root, tenantId, key);
      await fs.mkdir(path.dirname(full), { recursive: true });
      await fs.writeFile(full, bytes);
      return objectPath(tenantId, key);
    },
    async get(tenantId, key) {
      try { return new Uint8Array(await fs.readFile(localPath(root, tenantId, key))); }
      catch (e) { if (isMissing(e)) return null; throw e; }
    },
    async remove(tenantId, key) {
      await fs.rm(localPath(root, tenantId, key), { force: true });
    },
    async stat(tenantId, key) {
      try {
        const st = await fs.stat(localPath(root, tenantId, key));
        return st.isFile() ? { key, size: st.size, updatedAt: st.mtime.toISOString() } : null;
      } catch (e) { if (isMissing(e)) return null; throw e; }
    },
    async list(tenantId, prefix) {
      const pre = safePrefix(prefix);
      const base = path.resolve(root, tenantFolder(tenantId));
      const dir = pre ? localPath(root, tenantId, pre) : base;
      let names: string[];
      try { names = (await fs.readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name).sort(); }
      catch (e) { if (isMissing(e)) return []; throw e; }
      const out: FileInfo[] = [];
      for (const n of names.slice(0, 1000)) {
        const key = pre ? `${pre}/${n}` : n;
        try { safeKey(key); } catch { continue; } // never surface a name the store would refuse to address
        const st = await fs.stat(path.join(dir, n)).catch(() => null);
        if (st?.isFile()) out.push({ key, size: st.size, updatedAt: st.mtime.toISOString() });
      }
      return out;
    },
    publicUrl(tenantId, key) {
      if (bucket !== "brand-assets") throw new Error("publicUrl is only available for the brand-assets bucket.");
      return `/api/brand-assets/${objectPath(tenantId, key)}`;
    },
  };
}
