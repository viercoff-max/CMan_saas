import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getLocale, makeT, type Dict } from "@/lib/i18n";
import { shellDict } from "@/lib/shell-dict";
import { login } from "@/lib/auth";
import { authBackend } from "@/lib/auth/backend";
import { safeNext, withNext } from "@/lib/auth/redirect";
import { ensureSeed } from "@/lib/seed";
import { clientIp } from "@/lib/security/client-ip";
import { Button, Field, inputCls } from "@/components/ui";
import { NOINDEX } from "@/lib/platform/seo";
import { AuthCard, Notice, linkCls } from "./AuthCard";

// Generic hint shown with the error: never says which field was wrong or that the account is locked.
const loginDict: Dict = {
  es: { "login.hint": "Si fallas varias veces seguidas, espera 15 minutos antes de intentar de nuevo." },
  en: { "login.hint": "After several failed attempts, wait 15 minutes before trying again." },
};

const NOTICES: Record<string, string> = { confirmed: "login.confirmed", link_invalid: "login.linkInvalid", password_changed: "login.passwordChanged" };

type Search = { error?: string; next?: string; notice?: string };

// Private screen: never indexed (REVIEW-qa-2 P2-28). The root template adds the platform name.
export async function generateMetadata(): Promise<Metadata> {
  return { title: makeT(shellDict, await getLocale())("login.title"), robots: NOINDEX };
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<Search> }) {
  return authBackend() === "supabase" ? SupabaseLogin({ searchParams }) : LocalLogin({ searchParams });
}

/** DATA_BACKEND=sqlite (default): unchanged local email + password login. */
async function LocalLogin({ searchParams }: { searchParams: Promise<Search> }) {
  const locale = await getLocale();
  const t = makeT(shellDict, locale);
  const tl = makeT(loginDict, locale);
  const { error } = await searchParams;
  async function action(form: FormData) {
    "use server";
    await ensureSeed();
    const ip = clientIp(await headers());
    const { ok } = await login(String(form.get("email") ?? ""), String(form.get("password") ?? ""), ip);
    redirect(ok ? "/dashboard" : "/login?error=1");
  }
  return (
    <AuthCard title={t("login.title")}>
        <form action={action} className="space-y-4">
          <Field label={t("login.email")}><input name="email" type="email" required autoFocus autoComplete="username" maxLength={320} className={inputCls} /></Field>
          <Field label={t("login.password")}><input name="password" type="password" required autoComplete="current-password" maxLength={1024} className={inputCls} /></Field>
          {error && (
            <div role="alert" className="text-sm text-danger">
              <p>{t("login.error")}</p>
              <p className="mt-1 text-xs">{tl("login.hint")}</p>
            </div>
          )}
          <Button type="submit" size="lg" className="w-full">{t("login.submit")}</Button>
        </form>
        {/* Local mode has no e-mail reset (/login/forgot redirects here): say who can help instead. */}
        <p className="mt-4 text-center text-sm text-muted">{t("login.localForgot")}</p>
    </AuthCard>
  );
}

/** DATA_BACKEND=supabase: Supabase Auth email + password. */
async function SupabaseLogin({ searchParams }: { searchParams: Promise<Search> }) {
  const t = makeT(shellDict, await getLocale());
  const { error, next, notice } = await searchParams;
  const nextPath = safeNext(next);
  async function action(form: FormData) {
    "use server";
    const [{ createSupabaseServerClient }, { signIn }, { listMemberships }, { auditSignIn }] = await Promise.all([
      import("@/lib/auth/supabase-server"), import("@/lib/auth/supabase-account"), import("@/lib/auth/supabase-session"),
      import("@/lib/audit-events"),
    ]);
    const back = safeNext(form.get("next"));
    const client = await createSupabaseServerClient();
    const ip = clientIp(await headers());
    // M2: throttled per client IP and per e-mail before Supabase Auth is called (same generic error when limited).
    const { ok, userId } = await signIn(client, { email: form.get("email"), password: form.get("password") }, { ip });
    // Audit (server side, hashed IP only; never the email). Memberships through the user's own session (RLS).
    const tenantIds = ok && userId ? (await listMemberships(client, userId).catch(() => [])).map((m) => m.id) : [];
    await auditSignIn({ ok, userId, tenantIds }, ip);
    redirect(ok ? back : withNext("/login?error=1", back));
  }
  const noticeKey = notice ? NOTICES[notice] : undefined;
  return (
    <AuthCard title={t("login.title")}>
      {noticeKey && <Notice tone={notice === "link_invalid" ? "error" : "info"}>{t(noticeKey)}</Notice>}
      <form action={action} className="space-y-4">
        <input type="hidden" name="next" value={nextPath} />
        <Field label={t("login.email")}><input name="email" type="email" required autoFocus autoComplete="username" maxLength={320} className={inputCls} /></Field>
        <Field label={t("login.password")}><input name="password" type="password" required autoComplete="current-password" maxLength={1024} className={inputCls} /></Field>
        {error && <p role="alert" className="text-sm text-danger">{t("login.errorSupabase")}</p>}
        <Button type="submit" size="lg" className="w-full">{t("login.submit")}</Button>
      </form>
      <div className="mt-4 space-y-2 text-center text-sm">
        <p><Link href="/login/forgot" className={linkCls}>{t("login.forgot")}</Link></p>
        <p className="text-muted">{t("login.noAccount")} <Link href={withNext("/signup", nextPath)} className={linkCls}>{t("login.signupLink")}</Link></p>
      </div>
    </AuthCard>
  );
}
