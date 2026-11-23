import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getAuthState, logout, setActiveTenant } from "@/lib/auth";
import { authBackend } from "@/lib/auth/backend";
import { getLocale } from "@/lib/i18n";
import { ensureSeed } from "@/lib/seed";
import { LocaleProvider } from "@/lib/i18n-client";
import { Sidebar } from "@/components/Sidebar";
import { loadShellBrand } from "@/lib/brand/server";
import { loadInboxCounts } from "./inbox/counts";
import { isDemoBusiness } from "@/lib/demo/business";
import { DemoBanner } from "./DemoBanner";
import { NoticeListener } from "@/components/NoticeListener";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (authBackend() === "sqlite") await ensureSeed(); // first-run local admin; Supabase users sign up instead
  const st = await getAuthState();
  if (st.status === "anonymous") redirect("/login");
  if (st.status === "no_tenant") redirect("/onboarding");
  const session = st.session;
  const locale = await getLocale();
  const tenantName = session.tenants.find((t) => t.id === session.tenantId)?.name || session.tenantId;
  const supabaseMode = authBackend() === "supabase";
  const [{ counts }, brand, demo] = await Promise.all([
    loadInboxCounts(session.tenantId), // same loader as the inbox banner and the dashboard KPI
    // Tenant theme computed HERE (server side) and applied as an inline style: no flash of the default colours.
    loadShellBrand(session.tenantId, tenantName),
    supabaseMode ? isDemoBusiness(session.tenantId).catch(() => false) : Promise.resolve(false),
  ]);
  const waiting = counts.needs_human;

  async function doLogout() { "use server"; await logout(); redirect("/login"); }
  async function toggleLang() {
    "use server";
    const jar = await cookies();
    jar.set("locale", (jar.get("locale")?.value === "en" ? "es" : "en"), { path: "/", maxAge: 60 * 60 * 24 * 365 });
    revalidatePath("/", "layout");
  }
  /** Validated against the user's memberships (a forged id is ignored). */
  async function switchTenant(form: FormData) {
    "use server";
    await setActiveTenant(form.get("tenantId"));
    redirect("/dashboard");
  }

  return (
    <LocaleProvider locale={locale}>
      <div className="flex min-h-screen flex-col md:flex-row" data-brand={brand.style ? "" : undefined} style={(brand.style ?? undefined) as React.CSSProperties | undefined}>
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:text-ink">{locale === "en" ? "Skip to content" : "Saltar al contenido"}</a>
        <Sidebar tenantName={brand.displayName} logoUrl={brand.logoUrl} onLogout={doLogout} onToggleLang={toggleLang} waiting={waiting}
          role={session.role} tenants={session.tenants} activeTenantId={session.tenantId} onSwitchTenant={switchTenant}
          demoHref={supabaseMode ? "/onboarding/demo" : undefined} />
        <main id="main" className="flex-1 p-4 md:p-8"><div className="mx-auto max-w-5xl">
          {demo && <DemoBanner canDelete={session.role === "owner"} />}
          {children}
        </div></main>
        <NoticeListener />
      </div>
    </LocaleProvider>
  );
}
