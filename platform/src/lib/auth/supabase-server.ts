// USER-session Supabase client for server components, server actions and route handlers (official @supabase/ssr
// pattern for Next, adapted to Next 16 async cookies()). Uses the publishable key + the user's auth cookies, so RLS
// applies to every query made with it. Create one per request; never cache it in a module variable.
import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { supabasePublicEnv } from "./backend";
import { baseCookieOptions } from "./cookies";

export class SupabaseNotConfiguredError extends Error {
  constructor() { super("supabase_not_configured"); }
}

export async function createSupabaseServerClient(): Promise<SupabaseClient> {
  const env = supabasePublicEnv();
  if (!env) throw new SupabaseNotConfiguredError();
  const jar = await cookies();
  return createServerClient(env.url, env.key, {
    // httpOnly: this app has no browser Supabase client, so scripts never need the auth cookies.
    cookieOptions: baseCookieOptions(),
    cookies: {
      getAll() { return jar.getAll(); },
      setAll(toSet) {
        try {
          for (const { name, value, options } of toSet) jar.set(name, value, options);
        } catch {
          // Called from a Server Component (cookies are read-only there). src/proxy.ts refreshes the session instead.
        }
      },
    },
  });
}
