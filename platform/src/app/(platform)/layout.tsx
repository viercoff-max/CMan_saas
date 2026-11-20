// Platform-owner area. Its own shell with the PLATFORM identity (lib/platform/brand.ts), never a tenant's brand.
// The layout checks too (not only the page), so a non-admin never sees this header around the 404.
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import type { Metadata } from "next";
import { logout } from "@/lib/auth";
import { getLocale, makeT } from "@/lib/i18n";
import { requirePlatformAdmin } from "@/lib/platform/admin";
import { PLATFORM_BRAND } from "@/lib/platform/brand";
import { platformDict } from "@/lib/platform/dict";
import { platformAdminMetadata } from "@/lib/platform/seo";
import { PlatformWordmark, platformThemeStyle } from "@/lib/platform/ui";

export const dynamic = "force-dynamic";
export const metadata: Metadata = platformAdminMetadata;

const initials = (name: string, email: string) =>
  ((name || email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("") || "?").toUpperCase();

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  const admin = await requirePlatformAdmin();
  const locale = await getLocale();
  const t = makeT(platformDict, locale);
  const c = PLATFORM_BRAND.colors;

  async function doLogout() { "use server"; await logout(); redirect("/login"); }
  async function toggleLang() {
    "use server";
    const jar = await cookies();
    jar.set("locale", jar.get("locale")?.value === "en" ? "es" : "en", { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    revalidatePath("/platform");
  }

  return (
    <div style={platformThemeStyle} className="min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-lg focus:bg-surface focus:px-3 focus:py-2 focus:text-ink">{t("nav.skip")}</a>
      <header style={{ background: c.deep, color: c.deepText }}>
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-3 md:px-8">
          <PlatformWordmark locale={locale} dark />
          <nav aria-label={t("admin.navLabel")} className="flex items-center gap-2 text-sm">
            <span aria-current="page" className="rounded-lg bg-white/10 px-3 py-2 font-semibold text-white">{t("admin.title")}</span>
            <form action={toggleLang}>
              <button type="submit" lang={locale === "es" ? "en" : "es"} aria-label={t("nav.langLabel")} className="min-h-11 rounded-lg px-3 py-2 text-white/85 hover:bg-white/10 hover:text-white">{t("nav.lang")}</button>
            </form>
            <form action={doLogout}>
              <button type="submit" className="min-h-11 rounded-lg px-3 py-2 text-white/85 hover:bg-white/10 hover:text-white">{t("admin.logout")}</button>
            </form>
            <span title={admin.name || admin.email} aria-hidden="true" className="flex h-9 w-9 items-center justify-center rounded-full bg-white/15 text-xs font-bold text-white">
              {initials(admin.name, admin.email)}
            </span>
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-7xl px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
