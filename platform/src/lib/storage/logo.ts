// Brand logo upload (wave 2 branding screen). SERVER ONLY. PNG, JPEG or WebP only, max 2 MB (the "brand-assets"
// bucket limits), checked by magic bytes AND declared type; SVG is always rejected (it can carry scripts).
// Each upload gets a new random key ("logo-<uuid>.<ext>"), so the public URL changes and caches never serve an old logo.
// Typical flow: const r = await uploadLogo(tenantId, bytes, file.type); if (r.ok) { await getData().brand.save(tenantId,
// { logoPath: r.path }); await removeLogo(tenantId, previousLogoPath); }  -> show r.url (or logoUrl(tenantId, path)).
// NOTE: relative imports only (CLI scripts load src/lib with Node's type stripping).
import { randomUUID } from "node:crypto";
import { getFileStore } from "./index";
import { keyFromStored } from "./paths";

export const LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const LOGO_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;
export type LogoType = keyof typeof LOGO_TYPES;
export type UploadLogoResult = { ok: true; path: string; url: string } | { ok: false; error: "empty" | "too_big" | "bad_type" };

/** Image type from the first bytes, or null (SVG/XML, GIF, anything else). */
export function sniffImage(b: Uint8Array): LogoType | null {
  if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  return null;
}

const normType = (t: string) => {
  const m = String(t ?? "").split(";")[0].trim().toLowerCase();
  return m === "image/jpg" || m === "image/pjpeg" ? "image/jpeg" : m;
};

export async function uploadLogo(tenantId: string, bytes: Uint8Array, contentType: string): Promise<UploadLogoResult> {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) return { ok: false, error: "empty" };
  if (bytes.byteLength > LOGO_MAX_BYTES) return { ok: false, error: "too_big" };
  const declared = normType(contentType);
  const sniffed = sniffImage(bytes);
  // Both must agree: a renamed SVG/HTML never passes, and the stored Content-Type is always the real one.
  if (!sniffed || declared !== sniffed) return { ok: false, error: "bad_type" };
  const store = getFileStore("brand-assets");
  const key = `logo-${randomUUID()}.${LOGO_TYPES[sniffed]}`;
  const path = await store.put(tenantId, key, bytes, sniffed);
  return { ok: true, path, url: store.publicUrl(tenantId, key) };
}

/** Public URL of a stored logo path (brand.logoPath), or null when it is not this tenant's logo. */
export function logoUrl(tenantId: string, stored: string | null | undefined): string | null {
  const key = keyFromStored(tenantId, stored);
  return key ? getFileStore("brand-assets").publicUrl(tenantId, key) : null;
}

/** Deletes a previously stored logo (no-op for null / another tenant's path). */
export async function removeLogo(tenantId: string, stored: string | null | undefined): Promise<void> {
  const key = keyFromStored(tenantId, stored);
  if (key) await getFileStore("brand-assets").remove(tenantId, key);
}
