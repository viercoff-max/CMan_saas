// "Olvidé mi contraseña" (Supabase mode). Always shows the same message: never says whether the email exists.
import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, makeT } from "@/lib/i18n";
import { shellDict } from "@/lib/shell-dict";
import { authBackend } from "@/lib/auth/backend";
import { Button, Field, inputCls } from "@/components/ui";
import { AuthCard, Notice, linkCls } from "../AuthCard";

export default async function ForgotPage({ searchParams }: { searchParams: Promise<{ sent?: string }> }) {
  if (authBackend() !== "supabase") redirect("/login");
  const t = makeT(shellDict, await getLocale());
  const { sent } = await searchParams;
  async function action(form: FormData) {
    "use server";
    const [{ createSupabaseServerClient }, { requestPasswordReset }, { appBaseUrl }] = await Promise.all([
      import("@/lib/auth/supabase-server"), import("@/lib/auth/supabase-account"), import("@/lib/auth/base-url"),
    ]);
    const base = await appBaseUrl();
    await requestPasswordReset(await createSupabaseServerClient(), form.get("email"), `${base}/auth/confirm?next=${encodeURIComponent("/login/reset")}`);
    redirect("/login/forgot?sent=1");
  }
  return (
    <AuthCard title={t("forgot.title")} subtitle={sent ? undefined : t("forgot.subtitle")}>
      {sent ? (
        <Notice>{t("forgot.sent")}</Notice>
      ) : (
        <form action={action} className="space-y-4">
          <Field label={t("login.email")}><input name="email" type="email" required autoFocus autoComplete="username" maxLength={320} className={inputCls} /></Field>
          <Button type="submit" size="lg" className="w-full">{t("forgot.submit")}</Button>
        </form>
      )}
      <p className="mt-4 text-center text-sm"><Link href="/login" className={linkCls}>{t("forgot.back")}</Link></p>
    </AuthCard>
  );
}
