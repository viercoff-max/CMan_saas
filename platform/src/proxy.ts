// Next 16 Proxy (formerly Middleware). Only job: keep the Supabase Auth session fresh (DATA_BACKEND=supabase).
// In sqlite mode it does nothing. It is an optimistic layer only: every layout, server action and route handler
// still checks the session/role itself (see node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md).
import { NextResponse, type NextRequest } from "next/server";
import { authBackend } from "@/lib/auth/backend";
import { refreshSupabaseSession } from "@/lib/auth/proxy-session";

export async function proxy(request: NextRequest) {
  if (authBackend() !== "supabase") return NextResponse.next();
  return refreshSupabaseSession(request);
}

export const config = {
  // Skip static assets, the channel webhooks and the ManyChat integration (machine calls, no user session).
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/webhooks|api/integrations|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)"],
};
