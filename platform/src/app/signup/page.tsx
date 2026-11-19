// "Crea tu cuenta" (Supabase mode). After submit the screen always says "revisa tu correo" (no account enumeration).
// The confirmation link lands on /auth/confirm, which signs the user in and continues to `next` (default: the app,
// which sends a user without a business to /onboarding).
import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getLocale, makeT } from "@/lib/i18n";
import { shellDict } from "@/lib/shell-dict";
import { authBackend } from "@/lib/auth/backend";
import { AUTH_NEXT_COOKIE, baseCookieOptions } from "@/lib/auth/cookies";
import { safeNext, withNext } from "@/lib/auth/redirect";
import { Button, Field, inputCls } from "@/components/ui";
import { AuthCard, Notice, linkCls } from "../login/AuthCard";

const ERRORS: Record<string, string> = { weak_password: "signup.errWeak", invalid: "signup.errInvalid", failed: "signup.errFailed" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string; next?: string }> }) {
  const t = makeT(shellDict, await getLocale());
  if (authBackend() !== "supabase") {
    return (
      <AuthCard title={t("signup.title")}>
        <Notice>{t("signup.unavailable")}</Notice>
        <p className="text-center text-sm"><Link href="/login" className={linkCls}>{t("signup.loginLink")}</Link></p>
      </AuthCard>
    );
  }
  const { sent, error, next } = await searchParams;
  const nextPath = safeNext(next);

  async function action(form: FormData) {
    "use server";
    const [{ createSupabaseServerClient }, { signUp }, { appBaseUrl }] = await Promise.all([
      import("@/lib/auth/supabase-server"), import("@/lib/auth/supabase-account"), import("@/lib/auth/base-url"),
    ]);
    const back = safeNext(form.get("next"));
    const base = await appBaseUrl();
    const r = await signUp(
      await createSupabaseServerClient(),
      { email: form.get("email"), password: form.get("password"), name: form.get("name") },
      `${base}/auth/confirm?next=${encodeURIComponent(back)}`,
    );
    if (!r.ok) redirect(withNext(`/signup?error=${r.error}`, back));
    // Backup for email templates that drop the redirect's query string (read once by /auth/confirm, same browser).
    (await cookies()).set(AUTH_NEXT_COOKIE, back, { ...baseCookieOptions(), maxAge: 60 * 60 * 24 });
    redirect("/signup?sent=1");
  }

  if (sent) {
    return (
      <AuthCard title={t("signup.sentTitle")}>
        <Notice>{t("signup.sent")}</Notice>
        <p className="text-center text-sm"><Link href="/login" className={linkCls}>{t("signup.loginLink")}</Link></p>
      </AuthCard>
    );
  }
  const errKey = error ? ERRORS[error] ?? "signup.errFailed" : undefined;
  return (
    <AuthCard title={t("signup.title")} subtitle={t("signup.subtitle")}>
      <form action={action} className="space-y-4">
        <input type="hidden" name="next" value={nextPath} />
        <Field label={t("signup.name")}><input name="name" type="text" autoComplete="name" maxLength={120} className={inputCls} /></Field>
        <Field label={t("login.email")}><input name="email" type="email" required autoComplete="email" maxLength={320} className={inputCls} /></Field>
        <Field label={t("login.password")} hint={t("signup.passwordHint")}>
          <input name="password" type="password" required autoComplete="new-password" minLength={10} maxLength={72} className={inputCls} />
        </Field>
        {errKey && <p role="alert" className="text-sm text-danger">{t(errKey)}</p>}
        <Button type="submit" size="lg" className="w-full">{t("signup.submit")}</Button>
      </form>
      <p className="mt-4 text-center text-sm text-muted">
        {t("signup.haveAccount")} <Link href={withNext("/login", nextPath)} className={linkCls}>{t("signup.loginLink")}</Link>
      </p>
    </AuthCard>
  );
}
