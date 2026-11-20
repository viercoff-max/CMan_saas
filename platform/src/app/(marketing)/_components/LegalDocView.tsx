// Renders one legal / privacy document from lib/platform/content.ts, with the draft banner when `draft` and a
// "Completar antes de publicar" notice while owner-fillable legal fields (lib/platform/brand.ts) are empty.
import type { Locale } from "@/lib/i18n-shared";
import { LEGAL_FIELD_LABEL, PLATFORM_BRAND, missingLegalFields } from "@/lib/platform/brand";
import { completeNotice, deletionRequest, draftBanner, fill, fillParts, type LegalDoc } from "@/lib/platform/content";

export function DraftBanner({ locale }: { locale: Locale }) {
  const b = draftBanner[locale];
  return (
    <div role="note" data-testid="draft-banner" className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
      <p className="font-semibold">{b.title}</p>
      <p className="mt-1 text-sm">{b.body}</p>
    </div>
  );
}

/** Visible while any legal field is still null (never publish the pages in this state). */
export function CompleteNotice({ locale }: { locale: Locale }) {
  const missing = missingLegalFields();
  if (missing.length === 0) return null;
  const n = completeNotice[locale];
  return (
    <div role="note" data-testid="complete-notice" className="mb-6 rounded-xl border-2 border-dashed border-red-400 bg-red-50 px-4 py-3 text-red-900">
      <p className="font-semibold">{n.title}</p>
      <p className="mt-1 text-sm">{n.body}</p>
      <ul className="mt-1 list-disc pl-5 text-sm">{missing.map((f) => <li key={f}>{LEGAL_FIELD_LABEL[f][locale]}</li>)}</ul>
    </div>
  );
}

function Filled({ text, locale }: { text: string; locale: Locale }) {
  return (
    <>
      {fillParts(text, locale).map((p, i) =>
        p.kind === "text" ? <span key={i}>{p.text}</span>
          : p.kind === "email" ? <a key={i} href={`mailto:${p.email}`} className="font-medium text-brand underline underline-offset-2">{p.email}</a>
            : <mark key={i} data-testid="legal-missing" className="rounded bg-yellow-200 px-1 font-semibold text-ink">{p.label}</mark>)}
    </>
  );
}

/** Direct channel for deletion requests (Meta "data deletion instructions" URL): a mailto with a prepared subject. */
function DeletionRequest({ locale }: { locale: Locale }) {
  const d = deletionRequest[locale];
  const email = PLATFORM_BRAND.privacyContactEmail;
  return (
    <section className="mt-8 rounded-2xl border border-line bg-surface p-5">
      <h2 className="text-lg font-semibold text-ink">{d.title}</h2>
      {email ? (
        <a href={`mailto:${email}?subject=${encodeURIComponent(d.subject)}`}
          className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-brand px-4 text-sm font-medium text-on-brand hover:bg-brand-dark">{d.button}</a>
      ) : (
        <p className="mt-2 text-sm text-ink"><Filled text="{contact}" locale={locale} /> {d.missing}</p>
      )}
    </section>
  );
}

export function LegalDocView({ doc, locale, draft, deletion = false }: { doc: LegalDoc; locale: Locale; draft: boolean; deletion?: boolean }) {
  return (
    <article className="mx-auto max-w-3xl px-4 py-10 md:px-8">
      {draft && <DraftBanner locale={locale} />}
      <CompleteNotice locale={locale} />
      <h1 className="text-3xl font-bold tracking-tight text-ink">{fill(doc.title, locale)}</h1>
      <p className="mt-3 text-base text-muted"><Filled text={doc.intro} locale={locale} /></p>
      {doc.sections.map((s) => (
        <section key={s.h} className="mt-8">
          <h2 className="text-lg font-semibold text-ink">{fill(s.h, locale)}</h2>
          {s.p.map((p, i) => <p key={i} className="mt-2 leading-relaxed text-ink"><Filled text={p} locale={locale} /></p>)}
        </section>
      ))}
      {deletion && <DeletionRequest locale={locale} />}
    </article>
  );
}
