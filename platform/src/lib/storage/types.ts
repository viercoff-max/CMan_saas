// The FileStore contract (stage 4): tenant files (uploaded sources, section files, handoff outbox in Supabase mode) and
// public brand assets (logos). SERVER ONLY. Two backends, picked by DATA_BACKEND (see ./index.ts):
//   local    (DATA_BACKEND=sqlite, default): DATA_DIR/uploads/<tenantId>/<key> and DATA_DIR/brand-assets/<tenantId>/<key>
//   supabase (DATA_BACKEND=supabase):        Storage buckets "tenant-files" (private) / "brand-assets" (public),
//                                            object "<tenantId>/<key>", written with the service-role client.
// Rules: `key` is tenant-relative and built by the SERVER (paths.ts uploadKey / fixed names), never a user path;
// every method validates tenantId + key (StoragePathError); the tenant folder is always prepended by the store, so a
// tenant can only ever address its own folder. Persisted paths ("<tenantId>/<key>") are turned back into keys with
// keyFromStored(tenantId, stored), which returns null for another tenant's path.

export type FileBucket = "tenant-files" | "brand-assets";
export type StorageBackend = "local" | "supabase";

export interface FileInfo {
  /** Tenant-relative key ("outbox/x.txt"). */
  key: string;
  size: number;
  /** ISO time of the last write, or null when the backend does not say. */
  updatedAt: string | null;
}

export interface FileStore {
  readonly backend: StorageBackend;
  readonly bucket: FileBucket;
  /**
   * Stores (replaces) the bytes at "<tenantId>/<key>" and returns that object path, which is what callers persist
   * (sources.filePath, brand.logoPath). `contentType` must be allowed by the bucket (Supabase rejects others).
   */
  put(tenantId: string, key: string, bytes: Uint8Array, contentType: string): Promise<string>;
  /** The bytes, or null when the object does not exist. Throws StorageBackendError for other failures. */
  get(tenantId: string, key: string): Promise<Uint8Array | null>;
  /** Idempotent: removing a missing object is not an error. */
  remove(tenantId: string, key: string): Promise<void>;
  /** Size + last write, or null when missing. */
  stat(tenantId: string, key: string): Promise<FileInfo | null>;
  /** Files directly under "<tenantId>/<prefix>/" (not recursive, folders skipped), name order, at most 1000. */
  list(tenantId: string, prefix: string): Promise<FileInfo[]>;
  /**
   * Browser URL of a PUBLIC object (bucket "brand-assets" only; throws for "tenant-files").
   * Supabase: the bucket's public URL. Local: "/api/brand-assets/<tenantId>/<key>" (served by that route).
   */
  publicUrl(tenantId: string, key: string): string;
}

/** Storage failed for a reason that is not the caller's input. The message names only the bucket and operation. */
export class StorageBackendError extends Error {
  readonly code = "storage";
  constructor(message: string) { super(message); this.name = "StorageBackendError"; }
}
