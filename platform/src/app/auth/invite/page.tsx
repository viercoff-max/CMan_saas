// Accept an invitation link (/auth/invite?token=...). Supabase mode only.
// Signed out -> sign in / create the account and come back here (`next`). Signed in -> one button that calls
// public.accept_invitation, which checks the token hash, expiry and that the signed-in email is the invited one.
// Accepting is a POST (server action, Next's Origin check), never a side effect of opening the link.
import Link from "next/link";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { getLocale, makeT } from "@/lib/i18n";
import { shellDict } from "@/lib/shell-dict";
import { getAuthState } from "@/lib/auth";
import { authBackend } from "@/lib/auth/backend";
import { ACTIVE_TENANT_COOKIE, baseCookieOptions } from "@/lib/auth/cookies";
import { looksLikeInviteToken } from "@/lib/auth/invite-token";
import { withNext } from "@/lib/auth/redirect";
import { Button, LinkButton } from "@/components/ui";
import { AuthCard, Notice, linkCls } from "../../login/AuthCard";

export const dynamic = "force-dynamic";

export default async function InvitePage({ searchParams }: { searchParams: Promise<{ token?: string; error?: string }> }) {
  if (authBackend() !== "supabase") redirect("/login");
  const t = makeT(shellDict, await getLocale());
  const { token, error } = await searchParams;

  if (error || !looksLikeInviteToken(token)) {
    return (
      <AuthCard title={t("inv.title")}>
        <Notice tone="error">{t("inv.invalid")}</Notice>
        <p className="text-center text-sm"><Link href="/dashboard" className={linkCls}>{t("signup.loginLink")}</Link></p>
      </AuthCard>
    );
  }

  const here = `/auth/invite?token=${encodeURIComponent(token)}`;
  const st = await getAuthState();
  if (st.status === "anonymous") {
    return (
      <AuthCard title={t("inv.title")}>
        <p className="mb-4 text-sm text-muted">{t("inv.needLogin")}</p>
        <div className="flex flex-col gap-3">
          <LinkButton href={withNext("/login", here)} size="lg">{t("signup.loginLink")}</LinkButton>
          <p className="text-center text-sm"><Link href={withNext("/signup", here)} className={linkCls}>{t("login.signupLink")}</Link></p>
        </div>
      </AuthCard>
    );
  }
  const email = st.status === "ok" ? st.session.email : st.user.email;

  async function accept(form: FormData) {
    "use server";
    const tok = form.get("token");
    if (!looksLikeInviteToken(tok)) redirect("/auth/invite?error=1");
    const [{ createSupabaseServerClient }, { acceptInvite }] = await Promise.all([
      import("@/lib/auth/supabase-server"), import("@/lib/auth/team"),
    ]);
    const r = await acceptInvite(await createSupabaseServerClient(), tok);
    if (!r.ok) redirect("/auth/invite?error=1");
    // Preference only: getSession() re-checks it against the memberships on every request.
    (await cookies()).set(ACTIVE_TENANT_COOKIE, r.tenantId, { ...baseCookieOptions(), maxAge: 60 * 60 * 24 * 365 });
    redirect("/dashboard");
  }

  return (
    <AuthCard title={t("inv.title")}>
      <p className="mb-4 text-sm text-muted">{t("inv.body", { email })}</p>
      <form action={accept}>
        <input type="hidden" name="token" value={token} />
        <Button type="submit" size="lg" className="w-full">{t("inv.accept")}</Button>
      </form>
    </AuthCard>
  );
}
