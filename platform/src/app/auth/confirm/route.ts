// Email links from Supabase Auth (sign-up confirmation, password recovery, email change) land here.
// Supports both link styles:
//   ?token_hash=...&type=signup|email|recovery|...  (recommended email templates, works in any browser)
//   ?code=...                                        (PKCE redirect from the default templates, same browser only)
// On success the user has a cookie session and goes to `next` (relative paths only). Never logs tokens or emails.
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { EmailOtpType } from "@supabase/supabase-js";
import { authBackend } from "@/lib/auth/backend";
import { AUTH_NEXT_COOKIE } from "@/lib/auth/cookies";
import { safeNext } from "@/lib/auth/redirect";

const OTP_TYPES = new Set<EmailOtpType>(["signup", "email", "recovery", "invite", "magiclink", "email_change"]);

export async function GET(req: Request) {
  if (authBackend() !== "supabase") redirect("/login");
  const q = new URL(req.url).searchParams;
  const tokenHash = q.get("token_hash");
  const type = q.get("type") as EmailOtpType | null;
  const code = q.get("code");
  const jar = await cookies();
  const fallback = type === "recovery" ? "/login/reset" : "/dashboard";
  const dest = safeNext(q.get("next") ?? jar.get(AUTH_NEXT_COOKIE)?.value, fallback);
  jar.delete(AUTH_NEXT_COOKIE);

  let ok = false;
  try {
    const { createSupabaseServerClient } = await import("@/lib/auth/supabase-server");
    const client = await createSupabaseServerClient();
    if (tokenHash && type && OTP_TYPES.has(type) && tokenHash.length <= 512) {
      ok = !(await client.auth.verifyOtp({ type, token_hash: tokenHash })).error;
    } else if (code && code.length <= 512) {
      ok = !(await client.auth.exchangeCodeForSession(code)).error;
    }
  } catch {
    ok = false;
  }
  redirect(ok ? dest : "/login?notice=link_invalid");
}
