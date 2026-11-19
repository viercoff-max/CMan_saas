// Onboarding step 1 "Tu negocio" (Supabase mode). Signed-in users without a business land here from the app shell.
import { redirect } from "next/navigation";
import { getLocale, makeT } from "@/lib/i18n";
import { shellDict } from "@/lib/shell-dict";
import { getAuthState } from "@/lib/auth";
import { authBackend } from "@/lib/auth/backend";
import { AuthCard } from "../login/AuthCard";
import { OnboardingForm } from "./OnboardingForm";
import { onboardingLogout } from "./actions";

export const dynamic = "force-dynamic";

const KEYS = ["onb.name", "onb.slug", "onb.slugHint", "onb.submit", "onb.errName", "onb.errSlugFormat", "onb.errSlug", "onb.errLimit", "onb.errFailed"];

export default async function OnboardingPage() {
  if (authBackend() !== "supabase") redirect("/dashboard");
  const st = await getAuthState();
  if (st.status === "anonymous") redirect("/login?next=%2Fonboarding");
  const t = makeT(shellDict, await getLocale());
  return (
    <AuthCard wide eyebrow={t("onb.step")} title={t("onb.title")} subtitle={t("onb.subtitle")}>
      <OnboardingForm labels={Object.fromEntries(KEYS.map((k) => [k, t(k)]))} />
      <form action={onboardingLogout} className="mt-4 text-center">
        <button type="submit" className="min-h-11 text-sm text-muted underline underline-offset-2 hover:text-ink">{t("onb.logout")}</button>
      </form>
    </AuthCard>
  );
}
