// Shared upload checks for /api/sources/upload and /api/context/section-file (server only):
// multipart only, Content-Length required and capped, allowed extension + MIME, magic bytes, safe file name/path.
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { UPLOAD_DIR } from "../db";
import { contentMatchesExt, mimeMatchesExt } from "../security/upload";
import { ALLOWED_EXT, extOf, MAX_UPLOAD_BYTES } from "./extract";

/** Keep letters, digits, dot, dash, underscore; strip any path component. */
export function sanitizeName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "file";
  const clean = base.normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9._-]+/g, "_").replace(/^\.+/, "").slice(-80);
  return clean || "file";
}

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

/** Writes the bytes under UPLOAD_DIR/<tenantId>/ and returns the stored relative path (null if the path escapes). */
export async function storeUpload(tenantId: string, original: string, bytes: Uint8Array): Promise<string | null> {
  const rel = path.posix.join(tenantId, `${randomUUID()}-${original}`);
  const full = path.resolve(UPLOAD_DIR, rel);
  if (!full.startsWith(path.resolve(UPLOAD_DIR, tenantId) + path.sep)) return null;
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, bytes);
  return rel;
}
