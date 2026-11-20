// New password after the recovery link (/auth/confirm type=recovery created a short session). Supabase mode only.
import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, makeT } from "@/lib/i18n";
import { shellDict } from "@/lib/shell-dict";
import { authBackend } from "@/lib/auth/backend";
import { Button, Field, inputCls } from "@/components/ui";
import { AuthCard, Notice, linkCls } from "../AuthCard";

export default async function ResetPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (authBackend() !== "supabase") redirect("/login");
  const t = makeT(shellDict, await getLocale());
  const { error } = await searchParams;
  async function action(form: FormData) {
    "use server";
    const [{ createSupabaseServerClient }, { updatePassword }] = await Promise.all([
      import("@/lib/auth/supabase-server"), import("@/lib/auth/supabase-account"),
    ]);
    const client = await createSupabaseServerClient();
    // L4: only a fresh recovery session may set a password here; anything else is told to request a new link.
    const r = await updatePassword(client, form.get("password"));
    if (!r.ok) redirect(`/login/reset?error=${r.error === "reauth_required" ? "expired" : r.error}`);
    // Sign out everywhere so the recovery session cannot be reused; the user signs in with the new password.
    await client.auth.signOut({ scope: "global" }).catch(() => undefined);
    redirect("/login?notice=password_changed");
  }
  if (error === "expired") {
    return (
      <AuthCard title={t("reset.title")}>
        <Notice tone="error">{t("reset.expired")}</Notice>
        <p className="text-center text-sm"><Link href="/login/forgot" className={linkCls}>{t("reset.again")}</Link></p>
      </AuthCard>
    );
  }
  return (
    <AuthCard title={t("reset.title")}>
      <form action={action} className="space-y-4">
        <Field label={t("reset.password")} hint={t("reset.hint")}>
          <input name="password" type="password" required autoFocus autoComplete="new-password" minLength={10} maxLength={72} className={inputCls} />
        </Field>
        {error && <p role="alert" className="text-sm text-danger">{error === "weak_password" ? t("signup.errWeak") : t("team.errFailed")}</p>}
        <Button type="submit" size="lg" className="w-full">{t("reset.submit")}</Button>
      </form>
    </AuthCard>
  );
}
