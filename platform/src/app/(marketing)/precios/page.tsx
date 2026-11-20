// Plans without prices ("Precio por definir"). No checkout: the only action is creating an account.
import type { Metadata } from "next";
import { getLocale } from "@/lib/i18n";
import { Card, LinkButton } from "@/components/ui";
import { pricing } from "@/lib/platform/content";
import { publicMetadata } from "@/lib/platform/seo";

export async function generateMetadata(): Promise<Metadata> {
  const c = pricing[await getLocale()];
  return publicMetadata({ title: c.metaTitle, description: c.metaDescription });
}

export default async function PricingPage() {
  const c = pricing[await getLocale()];
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 md:px-8 md:py-14">
      <h1 className="text-3xl font-bold tracking-tight text-ink md:text-4xl">{c.title}</h1>
      <p className="mt-3 max-w-2xl text-base text-muted">{c.lead}</p>
      <ul className="mt-8 grid gap-4 md:grid-cols-3">
        {c.plans.map((p) => (
          <li key={p.name}>
            <Card className="flex h-full flex-col">
              <h2 className="text-xl font-semibold text-ink">{p.name}</h2>
              <p className="mt-1 text-sm text-muted">{p.for}</p>
              <p className="mt-4 text-lg font-semibold text-ink">{c.priceTbd}</p>
              <ul className="mt-4 flex-1 space-y-2 text-sm text-ink">
                {p.items.map((i) => (
                  <li key={i} className="flex gap-2"><span aria-hidden="true" className="text-brand">✓</span>{i}</li>
                ))}
              </ul>
              <div className="mt-6"><LinkButton href="/signup" variant="secondary">{c.cta}</LinkButton></div>
            </Card>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm text-muted">{c.note}</p>
    </div>
  );
}
