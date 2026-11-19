// Tenant slug: must match the DB check `^[a-z0-9][a-z0-9-]{1,62}$` (public.tenants.slug).
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

export function isValidSlug(s: string): boolean {
  return SLUG_RE.test(s);
}

/** "Café Aurora & Co." -> "cafe-aurora-co". Always returns a valid slug (falls back to "negocio"). */
export function slugify(name: string): string {
  let s = String(name ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
  if (s.length < 2) s = s ? `${s}-negocio` : "negocio";
  return s;
}
