// Open-redirect guard for "next" / "returnTo" parameters: only same-site RELATIVE paths are accepted.

/**
 * Returns `raw` when it is a relative path on this site ("/inbox", "/auth/invite?token=..."), otherwise `fallback`.
 * Rejected: absolute URLs, protocol-relative ("//evil.com"), backslash tricks ("/\\evil.com"), control characters,
 * and anything that would resolve to another origin.
 */
export function safeNext(raw: unknown, fallback = "/dashboard"): string {
  if (typeof raw !== "string") return fallback;
  const s = raw.trim();
  if (!s || s.length > 2048) return fallback;
  if (!s.startsWith("/") || s.startsWith("//") || s.includes("\\")) return fallback;
  if (/[\u0000-\u001f\u007f]/.test(s)) return fallback;
  try {
    const base = "https://app.invalid";
    const u = new URL(s, base);
    if (u.origin !== base) return fallback;
    return u.pathname + u.search + u.hash;
  } catch {
    return fallback;
  }
}

/** "/login?next=<encoded>" (or just "/login" when next is the default). */
export function withNext(path: string, next: string | null | undefined): string {
  const n = safeNext(next, "");
  if (!n || n === "/dashboard") return path;
  return `${path}${path.includes("?") ? "&" : "?"}next=${encodeURIComponent(n)}`;
}
