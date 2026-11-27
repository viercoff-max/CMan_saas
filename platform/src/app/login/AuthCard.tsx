// Centered card used by every signed-out screen (login, sign-up, password reset, invitation, onboarding).
// Branded with the PLATFORM identity (lib/platform/brand.ts), never a tenant's: logo + name, a link to the home page
// and the language switch (REVIEW-qa-2 P2-27/28). Server component.
import Link from "next/link";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { getLocale } from "@/lib/i18n";
import { PLATFORM_BRAND } from "@/lib/platform/brand";
import { PlatformWordmark, platformThemeStyle } from "@/lib/platform/ui";

const COPY = {
  es: { home: "Volver al inicio", lang: "English", langLabel: "Cambiar idioma a inglés" },
  en: { home: "Back to home", lang: "Español", langLabel: "Switch language to Spanish" },
} as const;

export async function AuthCard({ title, subtitle, eyebrow, children, wide }: { title: string; subtitle?: string; eyebrow?: string; children: ReactNode; wide?: boolean }) {
  const locale = await getLocale();
  const c = COPY[locale];
  async function toggleLang() {
    "use server";
    const jar = await cookies();
    jar.set("locale", jar.get("locale")?.value === "en" ? "es" : "en", { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
    revalidatePath("/", "layout");
  }
  return (
    <main style={platformThemeStyle} className="theme-light flex min-h-screen flex-col items-center justify-center gap-4 bg-canvas p-4 text-ink">
      <Link href="/" className="rounded-lg" aria-label={`${PLATFORM_BRAND.name} · ${c.home}`}><PlatformWordmark locale={locale} /></Link>
      <div className={`w-full rounded-3xl border-2 border-ink bg-surface p-6 shadow-[6px_6px_0_var(--brand)] ${wide ? "max-w-md" : "max-w-sm"}`}>
        {eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{eyebrow}</p>}
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        <div className="mt-4">{children}</div>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
        <Link href="/" className="inline-flex min-h-11 items-center rounded-lg px-3 text-muted hover:text-ink">{c.home}</Link>
        <form action={toggleLang}>
          <button type="submit" lang={locale === "es" ? "en" : "es"} aria-label={c.langLabel} className="inline-flex min-h-11 items-center rounded-lg px-3 text-muted hover:text-ink">{c.lang}</button>
        </form>
      </div>
    </main>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error"; children: ReactNode }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`mb-4 rounded-xl px-3 py-2 text-sm ${tone === "error" ? "bg-danger/10 text-danger" : "bg-canvas text-ink"}`}>
      {children}
    </div>
  );
}

export const linkCls = "font-medium text-brand underline underline-offset-2 hover:text-brand-dark";
