// "/" public landing. Signed-in users go straight to the app (/dashboard; the app layout sends a user without a
// business on to /onboarding).
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getAuthState } from "@/lib/auth";
import { getLocale } from "@/lib/i18n";
import { Card, LinkButton } from "@/components/ui";
import { PLATFORM_BRAND } from "@/lib/platform/brand";
import { landing } from "@/lib/platform/content";
import { publicMetadata } from "@/lib/platform/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const c = landing[await getLocale()];
  return publicMetadata({ title: c.metaTitle, description: c.metaDescription });
}

async function isSignedIn(): Promise<boolean> {
  try { return (await getAuthState()).status !== "anonymous"; }
  catch { return false; } // auth backend not configured: show the public page
}

export default async function LandingPage() {
  if (await isSignedIn()) redirect("/dashboard");
  const c = landing[await getLocale()];
  const col = PLATFORM_BRAND.colors;

  return (
    <>
      <section style={{ background: col.deep, color: col.deepText }}>
        <div className="mx-auto max-w-6xl px-4 py-14 md:px-8 md:py-20">
          <p className="text-xs font-semibold uppercase tracking-widest" style={{ color: col.deepMuted }}>{c.eyebrow}</p>
          <h1 className="mt-3 max-w-3xl text-3xl font-bold tracking-tight text-white md:text-5xl">{c.title}</h1>
          <p className="mt-4 max-w-2xl text-base md:text-lg" style={{ color: col.deepText }}>{c.lead}</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <LinkButton href="/signup" size="lg">{c.ctaPrimary}</LinkButton>
            <a href="/login" className="inline-flex min-h-11 items-center justify-center rounded-xl border border-white/40 px-5 py-3 text-base font-medium text-white hover:bg-white/10">{c.ctaSecondary}</a>
          </div>
          <div className="mt-10">
            <h2 className="text-sm font-semibold text-white">{c.channelsTitle}</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {c.channels.map((ch, i) => (
                <li key={ch.name} className={`rounded-full px-3 py-1 text-sm ${i === 0 ? "bg-white font-semibold text-ink" : "border border-white/30 text-white/85"}`}>
                  {ch.name} · {ch.state}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-12 md:px-8 md:py-16">
        <h2 className="text-2xl font-bold tracking-tight text-ink">{c.featuresTitle}</h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {c.features.map((f) => (
            <li key={f.h}>
              <Card className="h-full">
                <h3 className="text-base font-semibold text-ink">{f.h}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{f.p}</p>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-14 md:px-8">
        <Card>
          <h2 className="text-2xl font-bold tracking-tight text-ink">{c.stepsTitle}</h2>
          <ol className="mt-4 space-y-3">
            {c.steps.map((s, i) => (
              <li key={s} className="flex gap-3 text-ink">
                <span aria-hidden="true" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand text-sm font-semibold text-on-brand">{i + 1}</span>
                <span className="pt-0.5">{s}</span>
              </li>
            ))}
          </ol>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <LinkButton href="/signup">{c.ctaPrimary}</LinkButton>
            <LinkButton href="/precios" variant="secondary">{c.pricingLink}</LinkButton>
          </div>
          <p className="mt-4 text-sm text-muted">{c.honest}</p>
        </Card>
      </section>
    </>
  );
}
