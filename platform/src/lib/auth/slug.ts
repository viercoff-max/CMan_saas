// Tenant slug: must match the DB check `^[a-z0-9][a-z0-9-]{1,62}$` (public.tenants.slug).
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

/**
 * L8 (REVIEW-security-2): reserved tenant slugs / names (platform routes and roles, the platform brand, known customer
 * brands). MUST stay identical to app_private.is_reserved_tenant_word in
 * supabase/migrations/20261120013725_create_tenant_reserved_names.sql (create_tenant enforces it server-side);
 * src/lib/auth/__tests__/slug-reserved.test.ts fails when they drift apart.
 */
export const RESERVED_TENANT_WORDS: readonly string[] = [
  "admin", "administrator", "administrador", "root", "system", "sistema", "staff", "owner", "superuser",
  "api", "app", "apps", "www", "web", "mail", "email", "smtp", "cdn", "static", "assets", "files", "media",
  "auth", "oauth", "sso", "login", "logout", "signin", "signup", "register", "registro", "onboarding", "invite",
  "account", "accounts", "cuenta", "settings", "config", "dashboard", "inbox", "billing", "pagos", "payments",
  "support", "soporte", "help", "ayuda", "contact", "contacto", "security", "seguridad", "abuse", "status",
  "legal", "privacy", "privacidad", "terms", "terminos", "docs", "blog", "news", "about",
  "platform", "plataforma", "conversa", "official", "oficial", "verified", "verificado",
  "webhook", "webhooks", "telegram", "whatsapp", "instagram", "messenger", "meta", "facebook", "shopify",
  "anthropic", "claude", "supabase", "vercel",
  "null", "undefined", "test", "demo",
];
/** Anything containing the platform brand is reserved as well. */
export const RESERVED_SUBSTRING = "momentia";
const RESERVED = new Set(RESERVED_TENANT_WORDS);
const isReservedWord = (w: string) => w.includes(RESERVED_SUBSTRING) || RESERVED.has(w);

/** Exact reserved slug (case-insensitive, trimmed), as create_tenant checks it. */
export function isReservedSlug(slug: string): boolean {
  return isReservedWord(String(slug ?? "").trim().toLowerCase());
}

/** Business name whose lowercase letters/digits (everything else removed) form a reserved word ("A.D.M.I.N" too). */
export function isReservedName(name: string): boolean {
  return isReservedWord(String(name ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, ""));
}

/** Valid format AND not reserved (the onboarding validation helper). */
export function isValidSlug(s: string): boolean {
  return SLUG_RE.test(s) && !isReservedSlug(s);
}

/** "Café Aurora & Co." -> "cafe-aurora-co". Always returns a valid, non-reserved slug (falls back to "negocio"). */
export function slugify(name: string): string {
  let s = String(name ?? "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63)
    .replace(/-+$/g, "");
  if (s.length < 2) s = s ? `${s}-negocio` : "negocio";
  if (isReservedSlug(s)) s = s.includes(RESERVED_SUBSTRING) ? "negocio" : `${s.slice(0, 54)}-negocio`;
  return s;
}
