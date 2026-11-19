// Which login system is active. Follows DATA_BACKEND (see src/lib/data/index.ts):
//   sqlite (default) -> local email + password (signed "session" cookie, users table)
//   supabase         -> Supabase Auth (@supabase/ssr cookie session) + tenant_members
// Kept free of data-layer imports so src/proxy.ts can use it without loading node:sqlite.
export type AuthBackend = "sqlite" | "supabase";

export function authBackend(env: Record<string, string | undefined> = process.env): AuthBackend {
  return (env.DATA_BACKEND ?? "").trim().toLowerCase() === "supabase" ? "supabase" : "sqlite";
}

/** Public Supabase settings (browser-safe values, but this app only uses them on the server). */
export function supabasePublicEnv(env: Record<string, string | undefined> = process.env): { url: string; key: string } | null {
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  return url && key ? { url, key } : null;
}
