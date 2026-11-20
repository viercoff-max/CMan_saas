// Renders one legal / privacy document from lib/platform/content.ts, with the draft banner when `draft`.
import type { Locale } from "@/lib/i18n-shared";
import { draftBanner, fill, type LegalDoc } from "@/lib/platform/content";

export function DraftBanner({ locale }: { locale: Locale }) {
  const b = draftBanner[locale];
  return (
    <div role="note" data-testid="draft-banner" className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
      <p className="font-semibold">{b.title}</p>
      <p className="mt-1 text-sm">{b.body}</p>
    </div>
  );
}

export function LegalDocView({ doc, locale, draft }: { doc: LegalDoc; locale: Locale; draft: boolean }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 md:px-8">
      {draft && <DraftBanner locale={locale} />}
      <h1 className="text-3xl font-bold tracking-tight text-ink">{fill(doc.title, locale)}</h1>
      <p className="mt-3 text-base text-muted">{fill(doc.intro, locale)}</p>
      {doc.sections.map((s) => (
        <section key={s.h} className="mt-8">
          <h2 className="text-lg font-semibold text-ink">{fill(s.h, locale)}</h2>
          {s.p.map((p, i) => <p key={i} className="mt-2 leading-relaxed text-ink">{fill(p, locale)}</p>)}
        </section>
      ))}
    </article>
  );
}
