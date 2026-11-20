// Entry point of file storage (stage 4). SERVER ONLY (never import from a "use client" file).
//   getFileStore()               -> tenant files: uploaded sources, section files (+ the handoff outbox in Supabase mode)
//   getFileStore("brand-assets") -> public logos (use uploadLogo() in ./logo.ts, which validates the image first)
// The backend follows DATA_BACKEND: sqlite (default) -> local disk under DATA_DIR; supabase -> Supabase Storage.
// See ./types.ts for the contract and docs/ARCHITECTURE.md "Storage".
// NOTE: relative imports only (CLI scripts load src/lib with Node's type stripping).
import { BRAND_ASSETS_DIR, UPLOAD_DIR } from "../db";
import { createLocalFileStore } from "./local";
import { createSupabaseFileStore } from "./supabase";
import type { FileBucket, FileStore, StorageBackend } from "./types";

export type { FileBucket, FileInfo, FileStore, StorageBackend } from "./types";
export { StorageBackendError } from "./types";
export { keyFromStored, objectPath, safeKey, sanitizeName, StoragePathError, uploadKey } from "./paths";

export function storageBackend(env: Record<string, string | undefined> = process.env): StorageBackend {
  return (env.DATA_BACKEND ?? "").trim().toLowerCase() === "supabase" ? "supabase" : "local";
}

const g = globalThis as { __fileStores?: Map<string, FileStore> };

/** The FileStore for `bucket` on the configured backend (cached per backend + bucket). */
export function getFileStore(bucket: FileBucket = "tenant-files"): FileStore {
  const backend = storageBackend();
  const id = `${backend}:${bucket}`;
  g.__fileStores ??= new Map();
  let s = g.__fileStores.get(id);
  if (!s) {
    s = backend === "supabase"
      ? createSupabaseFileStore(bucket)
      : createLocalFileStore(bucket, bucket === "brand-assets" ? BRAND_ASSETS_DIR : UPLOAD_DIR);
    g.__fileStores.set(id, s);
  }
  return s;
}

/** TESTS ONLY: replace the cached store of a backend + bucket (e.g. a Supabase store on the in-memory fake). */
export function __setFileStoreForTests(backend: StorageBackend, bucket: FileBucket, store: FileStore | null): void {
  g.__fileStores ??= new Map();
  if (store) g.__fileStores.set(`${backend}:${bucket}`, store); else g.__fileStores.delete(`${backend}:${bucket}`);
}

/** Content types the "tenant-files" bucket accepts, by upload extension (the browser's MIME is never trusted). */
export const SOURCE_CONTENT_TYPES: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  txt: "text/plain",
  md: "text/markdown",
  csv: "text/csv",
  html: "text/html",
};
