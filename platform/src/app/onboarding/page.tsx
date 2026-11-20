// Onboarding (Supabase mode). Step 1 "Tu negocio": signed-in users without a business land here from the app shell.
// Step 2 "Tu marca" (?step=brand, right after creating the business): logo + main colour, skippable ("Lo hago
// después"), then the dashboard. It saves through POST /brand/save (admin of the ACTIVE tenant, like /brand).
import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, makeT, type Dict } from "@/lib/i18n";
import { shellDict } from "@/lib/shell-dict";
import { getAuthState, hasRole } from "@/lib/auth";
import { authBackend } from "@/lib/auth/backend";
import { getData } from "@/lib/data";
import { LocaleProvider } from "@/lib/i18n-client";
import { logoUrl } from "@/lib/storage/logo";
import { BrandForm } from "../(app)/brand/BrandForm";
import { brandDict } from "../(app)/brand/dict";
import { AuthCard, Notice } from "../login/AuthCard";
import { OnboardingForm } from "./OnboardingForm";
import { onboardingLogout } from "./actions";

export const dynamic = "force-dynamic";

// L1 (REVIEW-security-2): every tenant of this user is suspended. No app access and no new business (create_tenant
// refuses too); the platform operator lifts it.
const suspendedDict: Dict = {
  es: { "susp.title": "Cuenta suspendida", "susp.body": "El acceso a tu negocio está suspendido. Si crees que es un error, escribe a soporte de la plataforma." },
  en: { "susp.title": "Account suspended", "susp.body": "Access to your business is suspended. If you think this is a mistake, contact platform support." },
};

const KEYS = ["onb.name", "onb.slug", "onb.slugHint", "onb.submit", "onb.errName", "onb.errSlugFormat", "onb.errSlug", "onb.errLimit", "onb.errFailed"];

async function BrandStep() {
  const st = await getAuthState();
  if (st.status === "anonymous") redirect("/login?next=%2Fonboarding%3Fstep%3Dbrand");
  if (st.status === "no_tenant") redirect("/onboarding");
  const s = st.session;
  if (!hasRole(s.role, "admin")) redirect("/dashboard");
  const locale = await getLocale();
  const t = makeT(brandDict, locale);
  const b = await getData().brand.get(s.tenantId);
  const name = b.displayName || s.tenants.find((x) => x.id === s.tenantId)?.name || "";
  return (
    <LocaleProvider locale={locale}>
      <main className="mx-auto max-w-5xl p-4 md:p-8">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{t("onb.step")}</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{t("onb.title")}</h1>
        <p className="mb-6 mt-1 max-w-2xl text-sm text-muted">{t("onb.subtitle")}</p>
        <BrandForm mode="onboarding" doneHref="/dashboard" initial={{
          displayName: name, primaryColor: b.primaryColor.toUpperCase(), accentColor: b.accentColor.toUpperCase(),
          menuBgColor: b.menuBgColor.toUpperCase(), headingFont: b.headingFont, logoUrl: logoUrl(s.tenantId, b.logoPath),
        }} />
      </main>
    </LocaleProvider>
  );
}

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  if ((await searchParams).step === "brand") return <BrandStep />;
  const st = await getAuthState();
  if (st.status === "no_tenant" && st.suspended) {
    const locale = await getLocale();
    const ts = makeT(suspendedDict, locale), t = makeT(shellDict, locale);
    return (
      <AuthCard title={ts("susp.title")}>
        <Notice tone="error">{ts("susp.body")}</Notice>
        <form action={onboardingLogout} className="mt-4 text-center">
          <button type="submit" className="min-h-11 text-sm text-muted underline underline-offset-2 hover:text-ink">{t("onb.logout")}</button>
        </form>
      </AuthCard>
    );
  }
  if (authBackend() !== "supabase") redirect("/dashboard");
  if (st.status === "anonymous") redirect("/login?next=%2Fonboarding");
  const t = makeT(shellDict, await getLocale());
  return (
    <AuthCard wide eyebrow={t("onb.step")} title={t("onb.title")} subtitle={t("onb.subtitle")}>
      <OnboardingForm labels={Object.fromEntries(KEYS.map((k) => [k, t(k)]))} />
      <p className="mt-4 text-center text-sm">
        <Link href="/onboarding/demo" className="inline-flex min-h-11 items-center text-brand underline underline-offset-2">{t("onb.demo")}</Link>
      </p>
      <form action={onboardingLogout} className="mt-2 text-center">
        <button type="submit" className="min-h-11 text-sm text-muted underline underline-offset-2 hover:text-ink">{t("onb.logout")}</button>
      </form>
    </AuthCard>
  );
}
