// Cookie settings shared by both login backends. No imports: safe for src/proxy.ts.

/** Secure cookies whenever the app is served over HTTPS (tunnel), not only under NODE_ENV=production. */
export function cookieSecure(env: Record<string, string | undefined> = process.env): boolean {
  return env.NODE_ENV === "production" || (env.PUBLIC_URL ?? "").toLowerCase().startsWith("https://");
}

/** Active tenant (Supabase mode). Only a HINT: it is checked against the user's memberships on every request. */
export const ACTIVE_TENANT_COOKIE = "active_tenant";
/** Where to go after the email confirmation link (same browser only; validated with safeNext when read). */
export const AUTH_NEXT_COOKIE = "auth_next";

export function baseCookieOptions() {
  return { httpOnly: true, sameSite: "lax" as const, secure: cookieSecure(), path: "/" };
}
