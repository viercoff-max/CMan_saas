// Object paths for the FileStore (server only). Every object lives under "<tenantId>/<key>"; the server always builds
// the key (never a raw user path): file names go through sanitizeName() and get a random prefix.
// NOTE: relative imports only and no TS parameter properties (the CLI scripts load src/lib with Node's type stripping).
import { randomUUID } from "node:crypto";

/** Thrown for a tenant id or key that is not a safe object path. The message never contains the path. */
export class StoragePathError extends Error {
  readonly code = "invalid_path";
  constructor() { super("invalid storage path"); this.name = "StoragePathError"; }
}

/** SQLite tenant ids ("chefman", "t-<uuid>") and Supabase uuids. */
const TENANT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** One path segment: letters, digits, dot, dash, underscore; never "." / ".." or a leading dot. */
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,119}$/;
export const MAX_KEY_LENGTH = 400;

/** Validated tenant folder name (uuids lower-cased so paths match the database ids). */
export function tenantFolder(tenantId: string): string {
  if (typeof tenantId !== "string" || !TENANT.test(tenantId)) throw new StoragePathError();
  return UUID.test(tenantId) ? tenantId.toLowerCase() : tenantId;
}

/** Validated tenant-relative key ("a.pdf", "outbox/x.txt"): at most 4 segments, no traversal, no empty segments. */
export function safeKey(key: string): string {
  if (typeof key !== "string" || !key || key.length > MAX_KEY_LENGTH) throw new StoragePathError();
  const parts = key.split("/");
  if (parts.length > 4 || parts.some((p) => !SEGMENT.test(p))) throw new StoragePathError();
  return key;
}

/** Validated folder prefix for list(): "" (tenant root) or a safe key without a trailing slash. */
export function safePrefix(prefix: string): string {
  const p = String(prefix ?? "").replace(/\/+$/, "");
  return p ? safeKey(p) : "";
}

/** "<tenantId>/<key>": what callers persist (sources.filePath / storage_path, brand.logoPath). */
export const objectPath = (tenantId: string, key: string): string => `${tenantFolder(tenantId)}/${safeKey(key)}`;

/**
 * Stored object path -> tenant-relative key, or null when the path is not THIS tenant's (another tenant's id, legacy
 * "demo/..." rows, traversal). This is the cross-tenant guard for every read/delete of a persisted path.
 */
export function keyFromStored(tenantId: string, stored: string | null | undefined): string | null {
  if (typeof stored !== "string" || !stored) return null;
  let folder: string;
  try { folder = tenantFolder(tenantId); } catch { return null; }
  const s = UUID.test(tenantId) ? stored.replace(/^[0-9a-f-]{36}\//i, (m) => m.toLowerCase()) : stored;
  if (!s.startsWith(`${folder}/`)) return null;
  try { return safeKey(s.slice(folder.length + 1)); } catch { return null; }
}

/** Keep letters, digits, dot, dash, underscore; strip any path component and accents. Never empty. */
export function sanitizeName(name: string): string {
  const base = String(name ?? "").split(/[\\/]/).pop() ?? "file";
  const clean = base.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^[.]+/, "").slice(-80);
  return clean.replace(/^[.]+/, "") || "file";
}

/** Server-built key for an uploaded file: "<uuid>-<sanitized name>" (unique, safe). */
export const uploadKey = (originalName: string): string => `${randomUUID()}-${sanitizeName(originalName)}`;
