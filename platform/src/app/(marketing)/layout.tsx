// Public site shell (landing, pricing, legal). Platform identity from lib/platform/brand.ts, never a tenant brand.
import Link from "next/link";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getLocale, makeT } from "@/lib/i18n";
import { PLATFORM_BRAND } from "@/lib/platform/brand";
import { platformDict } from "@/lib/platform/dict";
import { PlatformWordmark, platformThemeStyle } from "@/lib/platform/ui";

const navLink = "inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-ink hover:bg-canvas";
const footLink = "text-sm text-muted underline-offset-2 hover:text-ink hover:underline";

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = makeT(platformDict, locale);

  async function toggleLang() {
    "use server";
    const jar = await cookies();
    jar.set("locale", jar.get("locale")?.value === "en" ? "es" : "en", { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    revalidatePath("/", "layout");
  }

  return (
    <div style={platformThemeStyle} className="flex min-h-screen flex-col bg-canvas">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:text-ink">{t("nav.skip")}</a>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-3 md:px-8">
          <Link href="/" className="rounded-lg" aria-label={PLATFORM_BRAND.name}><PlatformWordmark locale={locale} /></Link>
          <nav aria-label={t("nav.main")} className="flex flex-wrap items-center gap-1">
            <Link href="/precios" className={navLink}>{t("nav.pricing")}</Link>
            <Link href="/login" className={navLink}>{t("nav.login")}</Link>
            <Link href="/signup" className="inline-flex min-h-11 items-center rounded-xl bg-brand px-4 text-sm font-medium text-on-brand hover:bg-brand-dark">{t("nav.signup")}</Link>
            <form action={toggleLang}>
              <button type="submit" lang={locale === "es" ? "en" : "es"} aria-label={t("nav.langLabel")} className={`${navLink} text-muted`}>{t("nav.lang")}</button>
            </form>
          </nav>
        </div>
      </header>
      <main id="main" className="flex-1">{children}</main>
      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-6 md:flex-row md:items-center md:justify-between md:px-8">
          <p className="text-sm text-muted">{t("footer.note", { brand: PLATFORM_BRAND.name })}</p>
          <nav aria-label={t("footer.legal")} className="flex flex-wrap gap-x-4 gap-y-2">
            <Link href="/privacidad" className={footLink}>{t("footer.privacy")}</Link>
            <Link href="/terminos" className={footLink}>{t("footer.terms")}</Link>
            <Link href="/eliminar-datos" className={footLink}>{t("footer.deletion")}</Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
