import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { countConversationsByStatus } from "@/lib/store";
import { cookies } from "next/headers";
import { getSession, logout } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { ensureSeed, getTenantName } from "@/lib/seed";
import { LocaleProvider } from "@/lib/i18n-client";
import { Sidebar } from "@/components/Sidebar";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  ensureSeed();
  const session = await getSession();
  if (!session) redirect("/login");
  const locale = await getLocale();

  async function doLogout() { "use server"; await logout(); redirect("/login"); }
  async function toggleLang() {
    "use server";
    const jar = await cookies();
    jar.set("locale", (jar.get("locale")?.value === "en" ? "es" : "en"), { path: "/", maxAge: 60 * 60 * 24 * 365 });
    revalidatePath("/", "layout");
  }

  return (
    <LocaleProvider locale={locale}>
      <div className="flex min-h-screen flex-col md:flex-row">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:text-ink">{locale === "en" ? "Skip to content" : "Saltar al contenido"}</a>
        <Sidebar tenantName={getTenantName(session.tenantId)} onLogout={doLogout} onToggleLang={toggleLang} waiting={countConversationsByStatus(session.tenantId).needs_human} />
        <main id="main" className="flex-1 p-4 md:p-8"><div className="mx-auto max-w-5xl">{children}</div></main>
      </div>
    </LocaleProvider>
  );
}
