// Shared upload checks for /api/sources/upload and /api/context/section-file (server only):
// multipart only, Content-Length required and capped, allowed extension + MIME, magic bytes, safe file name/path.
// The bytes go to the FileStore (lib/storage): local disk (DATA_DIR/uploads) or the private "tenant-files" bucket.
import { contentMatchesExt, mimeMatchesExt } from "../security/upload";
import { getFileStore, keyFromStored, sanitizeName, SOURCE_CONTENT_TYPES, uploadKey } from "../storage";
import { ALLOWED_EXT, extOf, MAX_UPLOAD_BYTES } from "./extract";

export { sanitizeName };

const err = (error: string, status: number) => Response.json({ error }, { status });

export interface ValidUpload { original: string; ext: string; bytes: Uint8Array; size: number; form: FormData }

/** Parses and validates the `file` field. Returns a ready-to-send error Response when anything is off. */
export async function readValidatedUpload(req: Request): Promise<ValidUpload | Response> {
  if (!(req.headers.get("content-type") ?? "").toLowerCase().startsWith("multipart/form-data")) return err("no_file", 400);
  // Browsers always send Content-Length for FormData; refusing chunked bodies keeps formData() from buffering unbounded input.
  const lenHeader = req.headers.get("content-length");
  if (!lenHeader) return err("too_big", 411);
  const len = Number(lenHeader);
  if (!Number.isFinite(len) || len > MAX_UPLOAD_BYTES + 64 * 1024) return err("too_big", 413);

  let form: FormData;
  try { form = await req.formData(); } catch { return err("no_file", 400); }
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) return err("no_file", 400);
  if (file.size > MAX_UPLOAD_BYTES) return err("too_big", 413);

  const original = sanitizeName(file.name);
  const ext = extOf(original);
  if (!(ALLOWED_EXT as readonly string[]).includes(ext) || !mimeMatchesExt(file.type, ext)) return err("bad_type", 400);
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!contentMatchesExt(bytes, ext)) return err("bad_type", 400);
  return { original, ext, bytes, size: file.size, form };
}

/**
 * Stores the bytes in the tenant's folder under a server-built key ("<uuid>-<sanitized name>", never the raw name)
 * with the content type of the extension (the browser's MIME is not trusted), and returns the object path
 * "<tenantId>/<key>" to save as sources.filePath. Null when storage failed (logged without paths or details).
 */
export async function storeUpload(tenantId: string, original: string, bytes: Uint8Array): Promise<string | null> {
  const type = SOURCE_CONTENT_TYPES[extOf(original)];
  if (!type) return null;
  try {
    return await getFileStore().put(tenantId, uploadKey(original), bytes, type);
  } catch (e) {
    console.error("[upload] storage write failed:", e instanceof Error ? e.name : "error");
    return null;
  }
}

/** Best-effort delete of a stored upload (e.g. the database row could not be created). */
export async function discardUpload(tenantId: string, stored: string | null): Promise<void> {
  const key = keyFromStored(tenantId, stored);
  if (key) await getFileStore().remove(tenantId, key).catch(() => undefined);
}
