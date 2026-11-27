// Public site shell (landing, pricing, legal). Platform identity ("hola conversa", lib/platform/brand.ts), never a
// tenant brand. Always the light identity (.theme-light), whatever the visitor's OS theme.
import Link from "next/link";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getLocale, makeT } from "@/lib/i18n";
import { PLATFORM_BRAND } from "@/lib/platform/brand";
import { landing } from "@/lib/platform/content";
import { platformDict } from "@/lib/platform/dict";
import { PlatformWordmark, platformThemeStyle } from "@/lib/platform/ui";

const navLink = "inline-flex min-h-11 items-center rounded-full px-3 text-sm font-medium text-ink hover:bg-surface";
const footLink = "inline-flex min-h-11 items-center text-sm text-white/80 underline-offset-2 hover:text-white hover:underline";

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  const t = makeT(platformDict, locale);
  const nav = landing[locale].nav;

  async function toggleLang() {
    "use server";
    const jar = await cookies();
    jar.set("locale", jar.get("locale")?.value === "en" ? "es" : "en", { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    revalidatePath("/", "layout");
  }

  return (
    <div style={platformThemeStyle} className="theme-light flex min-h-screen flex-col bg-canvas text-ink">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:text-ink">{t("nav.skip")}</a>
      <header className="z-40 border-b border-line/70 bg-canvas/90 backdrop-blur md:sticky md:top-0">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-5 py-3 md:px-10">
          <Link href="/" className="rounded-lg" aria-label={PLATFORM_BRAND.name}><PlatformWordmark locale={locale} /></Link>
          <nav aria-label={t("nav.main")} className="flex flex-wrap items-center gap-1">
            <span className="hidden items-center gap-1 lg:inline-flex">
              <Link href="/#como" className={navLink}>{nav.how}</Link>
              <Link href="/#equipos" className={navLink}>{nav.team}</Link>
              <Link href="/#empresas" className={navLink}>{nav.sizes}</Link>
              <Link href="/#seguridad" className={navLink}>{nav.trust}</Link>
            </span>
            <Link href="/precios" className={navLink.replace("inline-flex", "hidden sm:inline-flex")}>{t("nav.pricing")}</Link>
            <Link href="/login" className={navLink}>{t("nav.login")}</Link>
            <Link href="/signup" className="inline-flex min-h-11 items-center rounded-full border-2 border-ink bg-brand px-4 text-sm font-semibold text-on-brand shadow-[3px_3px_0_var(--ink)] transition hover:-translate-x-0.5 hover:-translate-y-0.5 hover:shadow-[5px_5px_0_var(--ink)]">{t("nav.signup")}</Link>
            <form action={toggleLang}>
              <button type="submit" lang={locale === "es" ? "en" : "es"} aria-label={t("nav.langLabel")} className={`${navLink} text-muted`}>{t("nav.lang")}</button>
            </form>
          </nav>
        </div>
      </header>
      <main id="main" className="flex-1">{children}</main>
      <footer className="bg-ink text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-5 py-6 md:flex-row md:items-center md:justify-between md:px-10">
          <p className="text-sm text-white/80">{t("footer.note", { brand: PLATFORM_BRAND.name })} · holaconversa.com</p>
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
