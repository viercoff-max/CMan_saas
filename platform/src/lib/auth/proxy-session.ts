// Session refresh for src/proxy.ts (Supabase mode). Official @supabase/ssr middleware pattern on Next 16 Proxy:
// read the request cookies, let the client refresh an expiring token, and copy the new cookies onto BOTH the
// forwarded request (so server components in this request see them) and the response (so the browser stores them).
// Authorization is NOT decided here: layouts, server actions and route handlers call getSession()/requireRole().
import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { supabasePublicEnv } from "./backend";
import { baseCookieOptions } from "./cookies";

export async function refreshSupabaseSession(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });
  const env = supabasePublicEnv();
  if (!env) return response;
  const supabase = createServerClient(env.url, env.key, {
    cookieOptions: baseCookieOptions(),
    cookies: {
      getAll() { return request.cookies.getAll(); },
      setAll(toSet, headers) {
        for (const { name, value } of toSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
        // no-store headers from @supabase/ssr: a response that sets auth cookies must never be cached.
        for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
      },
    },
  });
  // Must run before anything else: it validates the JWT and triggers the refresh when needed.
  try { await supabase.auth.getClaims(); } catch { /* network error: the page-level check decides */ }
  return response;
}
