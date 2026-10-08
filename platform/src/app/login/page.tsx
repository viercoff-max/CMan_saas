import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { getLocale, makeT, type Dict } from "@/lib/i18n";
import { shellDict } from "@/lib/shell-dict";
import { login } from "@/lib/auth";
import { ensureSeed } from "@/lib/seed";
import { clientIp } from "@/lib/security/client-ip";
import { Button, Card, Field, inputCls } from "@/components/ui";

// Generic hint shown with the error: never says which field was wrong or that the account is locked.
const loginDict: Dict = {
  es: { "login.hint": "Si fallas varias veces seguidas, espera 15 minutos antes de intentar de nuevo." },
  en: { "login.hint": "After several failed attempts, wait 15 minutes before trying again." },
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const locale = await getLocale();
  const t = makeT(shellDict, locale);
  const tl = makeT(loginDict, locale);
  const { error } = await searchParams;
  async function action(form: FormData) {
    "use server";
    ensureSeed();
    const ip = clientIp(await headers());
    const { ok } = await login(String(form.get("email") ?? ""), String(form.get("password") ?? ""), ip);
    redirect(ok ? "/dashboard" : "/login?error=1");
  }
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <h1 className="mb-4 text-xl font-semibold">{t("login.title")}</h1>
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
      </Card>
    </main>
  );
}
