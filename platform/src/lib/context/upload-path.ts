// LOCAL backend only (tests, local tooling): the disk path of a stored upload. App code reads and deletes files
// through the FileStore (lib/storage) so the same code works with Supabase Storage.
import { UPLOAD_DIR } from "../db";
import { keyFromStored } from "../storage";
import { localPath } from "../storage/local";

/** Resolve a stored file path ("<tenantId>/<key>"), refusing anything outside UPLOAD_DIR/<tenantId>. */
export function resolveUploadPath(tenantId: string, stored: string): string | null {
  const key = keyFromStored(tenantId, stored);
  if (!key) return null;
  try { return localPath(UPLOAD_DIR, tenantId, key); } catch { return null; }
}
