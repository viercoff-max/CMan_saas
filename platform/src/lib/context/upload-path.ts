import path from "node:path";
import { UPLOAD_DIR } from "../db";

/** Resolve a stored file path, refusing anything outside UPLOAD_DIR/<tenantId>. */
export function resolveUploadPath(tenantId: string, stored: string): string | null {
  const base = path.resolve(UPLOAD_DIR, tenantId);
  const full = path.resolve(UPLOAD_DIR, stored);
  return full.startsWith(base + path.sep) ? full : null;
}
