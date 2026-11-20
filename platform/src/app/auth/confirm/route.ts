// Email links from Supabase Auth (sign-up confirmation, password recovery, invitation, email change) land here.
// Supports both link styles:
//   ?token_hash=...&type=signup|email|recovery|...  (recommended email templates, works in any browser)
//   ?code=...                                        (PKCE redirect from the default templates, same browser only)
// L3 (REVIEW-security-2, login CSRF / session fixation): a token_hash link NEVER signs in on GET. GET renders a tiny
// confirm page whose button POSTs the token back here (same origin, checked); only the POST calls verifyOtp. So a
// link with an attacker's own token cannot silently sign a victim into the attacker's account. The PKCE `code` flow
// is already bound to this browser (the code verifier cookie was set by the same browser), so it is exchanged on GET.
// On success the user has a cookie session and goes to `next` (relative paths only). Never logs tokens or emails.
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import type { EmailOtpType } from "@supabase/supabase-js";
import { authBackend } from "@/lib/auth/backend";
import { AUTH_NEXT_COOKIE } from "@/lib/auth/cookies";
import { safeNext } from "@/lib/auth/redirect";
import { checkSameOrigin } from "@/lib/security/origin";

const OTP_TYPES = new Set<EmailOtpType>(["signup", "email", "recovery", "invite", "magiclink", "email_change"]);
const MAX_TOKEN = 512;
const MAX_BODY = 8 * 1024;
const INVALID = "/login?notice=link_invalid";

const isOtpType = (t: unknown): t is EmailOtpType => typeof t === "string" && OTP_TYPES.has(t as EmailOtpType);
const validToken = (t: unknown): t is string => typeof t === "string" && t.length > 0 && t.length <= MAX_TOKEN;

const ENT: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ENT[c]);

/** 303 (never 307): the browser must follow a POST with a GET. */
const seeOther = (to: string) => new Response(null, { status: 303, headers: { location: to, "cache-control": "no-store" } });

const COPY: Record<string, { title: string; body: string; button: string }> = {
  recovery: { title: "Restablecer contraseña", body: "Para continuar con el cambio de contraseña, confirma que fuiste tú quien lo pidió.", button: "Continuar" },
  invite: { title: "Aceptar invitación", body: "Confirma para continuar con tu invitación.", button: "Continuar" },
  email_change: { title: "Confirmar correo", body: "Confirma el cambio de correo de tu cuenta.", button: "Confirmar" },
  default: { title: "Confirmar acceso", body: "Confirma para entrar con el enlace que recibiste por correo. Si no lo pediste tú, cierra esta página.", button: "Continuar" },
};

function confirmPage(tokenHash: string, type: EmailOtpType, next: string): Response {
  const c = COPY[type] ?? COPY.default;
  const html = `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(c.title)}</title>
<style>body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,sans-serif;background:#f6f7f9;color:#14181f}
main{max-width:380px;margin:16px;padding:24px;background:#fff;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
h1{font-size:20px;margin:0 0 8px}p{font-size:14px;line-height:1.5;color:#4b5563;margin:0 0 20px}
button{width:100%;min-height:44px;border:0;border-radius:10px;background:#0f766e;color:#fff;font-size:15px;font-weight:600;cursor:pointer}</style></head>
<body><main><h1>${esc(c.title)}</h1><p>${esc(c.body)}</p>
<form method="post" action="/auth/confirm"><input type="hidden" name="token_hash" value="${esc(tokenHash)}"><input type="hidden" name="type" value="${esc(type)}"><input type="hidden" name="next" value="${esc(next)}">
<button type="submit">${esc(c.button)}</button></form></main></body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer", // the token stays out of Referer headers
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      // No scripts at all; the form may only post to this origin; never framed (no clickjacking of the button).
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
    },
  });
}

export async function GET(req: Request) {
  if (authBackend() !== "supabase") redirect("/login");
  const q = new URL(req.url).searchParams;
  const tokenHash = q.get("token_hash");
  const type = q.get("type");
  const code = q.get("code");
  const jar = await cookies();
  const fallback = type === "recovery" ? "/login/reset" : "/dashboard";
  const dest = safeNext(q.get("next") ?? jar.get(AUTH_NEXT_COOKIE)?.value, fallback);

  if (tokenHash || type) {
    // Interstitial only: nothing is verified and no session cookie changes until the user presses the button.
    if (validToken(tokenHash) && isOtpType(type)) return confirmPage(tokenHash, type, dest);
    jar.delete(AUTH_NEXT_COOKIE);
    redirect(INVALID);
  }

  jar.delete(AUTH_NEXT_COOKIE);
  let ok = false;
  if (validToken(code)) {
    try {
      const { createSupabaseServerClient } = await import("@/lib/auth/supabase-server");
      ok = !(await (await createSupabaseServerClient()).auth.exchangeCodeForSession(code)).error;
    } catch {
      ok = false;
    }
  }
  redirect(ok ? dest : INVALID);
}

/** The confirm button: same-origin form POST -> verifyOtp -> 303 to `next`. */
export async function POST(req: Request) {
  if (authBackend() !== "supabase") return seeOther("/login");
  const bad = checkSameOrigin(req); if (bad) return bad;
  const len = Number(req.headers.get("content-length") ?? "");
  if (!Number.isFinite(len) || len <= 0 || len > MAX_BODY) return seeOther(INVALID);
  let form: FormData;
  try { form = await req.formData(); } catch { return seeOther(INVALID); }
  const tokenHash = form.get("token_hash");
  const type = form.get("type");
  const dest = safeNext(form.get("next"), type === "recovery" ? "/login/reset" : "/dashboard");
  (await cookies()).delete(AUTH_NEXT_COOKIE);
  if (!validToken(tokenHash) || !isOtpType(type)) return seeOther(INVALID);
  let ok = false;
  try {
    const { createSupabaseServerClient } = await import("@/lib/auth/supabase-server");
    ok = !(await (await createSupabaseServerClient()).auth.verifyOtp({ type, token_hash: tokenHash })).error;
  } catch {
    ok = false;
  }
  return seeOther(ok ? dest : INVALID);
}
