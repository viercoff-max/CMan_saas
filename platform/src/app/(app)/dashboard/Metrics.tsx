// Dashboard metric cards (server component). Hero numbers for single figures; single-series bar charts (brand
// colour, value on hover / focus, data table under "Ver datos") for volume per day and per hour; ranked bar lists
// for breakdowns. Text always uses text tokens, never the bar colour.
import Link from "next/link";
import { Card } from "@/components/ui";
import type { Metrics, MetricKey } from "@/lib/metrics/dashboard";

type T = (k: string, v?: Record<string, string | number>) => string;
const fmtMin = (t: T, m: number | null) => (m == null ? "—" : m < 90 ? t("m.min", { n: Math.max(1, Math.round(m)) }) : t("m.hours", { n: (m / 60).toFixed(1) }));

function Hero({ title, value, hint, tone }: { title: string; value: string; hint?: string; tone?: "bad" }) {
  return (
    <Card className={`p-4 ${tone === "bad" ? "border-l-4 border-l-red-600" : ""}`}>
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</div>
      <div className="mt-1 text-3xl font-semibold text-ink">{value}</div>
      {hint && <div className="mt-1 text-sm text-muted">{hint}</div>}
    </Card>
  );
}

/** Vertical single-series bars with a hover/focus value and a data table. */
function Bars({ title, hint, rows, label, t }: { title: string; hint?: string; rows: { k: string; n: number }[]; label: (k: string) => string; t: T }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  const total = rows.reduce((a, r) => a + r.n, 0);
  const step = rows.length > 16 ? Math.ceil(rows.length / 8) : rows.length > 10 ? 2 : 1;
  return (
    <Card className="p-4 sm:col-span-2">
      <div className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</div>
      {hint && <div className="text-xs text-muted">{hint}</div>}
      {total === 0 ? <p className="mt-6 text-sm text-muted">{t("m.none")}</p> : (
        <>
          <div className="mt-3 flex h-32 items-end gap-[2px] border-b border-line" role="img" aria-label={`${title}: ${rows.map((r) => `${label(r.k)} ${r.n}`).join(", ")}`}>
            {rows.map((r) => (
              <div key={r.k} className="group relative flex h-full flex-1 items-end" tabIndex={0} aria-label={`${label(r.k)}: ${r.n}`}>
                <div className="w-full rounded-t-[4px] bg-brand" style={{ height: `${r.n ? Math.max(3, (r.n / max) * 100) : 0}%` }} />
                <span className="pointer-events-none absolute -top-7 left-1/2 z-10 hidden -translate-x-1/2 whitespace-nowrap rounded-md bg-ink px-2 py-0.5 text-xs text-surface group-hover:block group-focus:block">{label(r.k)}: {r.n}</span>
              </div>
            ))}
          </div>
          <div className="mt-1 flex gap-[2px] text-[10px] text-muted" aria-hidden>
            {rows.map((r, i) => <span key={r.k} className="flex-1 truncate text-center">{i % step === 0 ? label(r.k) : ""}</span>)}
          </div>
          <details className="mt-2 text-sm">
            <summary className="inline-flex min-h-11 cursor-pointer items-center text-brand underline decoration-dotted">{t("m.data")}</summary>
            <table className="mt-1 w-full text-left text-xs"><tbody>
              {rows.map((r) => <tr key={r.k} className="border-t border-line"><td className="py-1 text-muted">{label(r.k)}</td><td className="py-1 text-right text-ink">{r.n}</td></tr>)}
            </tbody></table>
          </details>
        </>
      )}
    </Card>
  );
}

/** Ranked horizontal bars (one series): label, bar, value. */
function Ranked({ title, rows, t }: { title: string; rows: { label: string; n: number }[]; t: T }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  return (
    <Card className="p-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{title}</div>
      {rows.length === 0 ? <p className="text-sm text-muted">{t("m.none")}</p> : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.label} className="text-sm">
              <div className="flex justify-between gap-2"><span className="truncate text-ink">{r.label}</span><span className="font-medium text-ink">{r.n}</span></div>
              <div className="mt-1 h-2 rounded-full bg-canvas"><div className="h-2 rounded-full bg-brand" style={{ width: `${(r.n / max) * 100}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export interface AiSummary { used: number; cap: number; percent: number; costUsd: number; perConversationUsd: number | null; noCap: boolean }

export function MetricCards({ cards, m, ai, t, locale, timeZone }: { cards: MetricKey[]; m: Metrics; ai: AiSummary | null; t: T; locale: string; timeZone: string }) {
  const num = (n: number) => n.toLocaleString(locale === "en" ? "en-US" : "es-MX");
  const dayLabel = (d: string) => { const [, mo, da] = d.split("-"); return `${Number(da)}/${Number(mo)}`; };
  const pick = (k: string, map: string) => (t(`${map}.${k}`) === `${map}.${k}` ? k : t(`${map}.${k}`));
  const card = (k: MetricKey) => {
    switch (k) {
      case "waiting": return <Hero key={k} title={t("m.c.waiting")} value={num(m.waiting)} tone={m.urgent ? "bad" : undefined} hint={m.urgent ? t("m.c.waiting.urgent", { n: m.urgent }) : undefined} />;
      case "bot_resolved": return <Hero key={k} title={t("m.c.bot_resolved")} value={m.botResolvedPct == null ? "—" : `${m.botResolvedPct}%`} hint={t("m.c.bot_resolved.hint")} />;
      case "conversations": return <Hero key={k} title={t("m.c.conversations")} value={num(m.conversations)} hint={t("m.c.conversations.hint")} />;
      case "handoffs": return <Hero key={k} title={t("m.c.handoffs")} value={num(m.handoffs)} hint={t("m.c.handoffs.hint")} />;
      case "first_response": return <Hero key={k} title={t("m.c.first_response")} value={fmtMin(t, m.firstResponseMin)} hint={t("m.c.first_response.hint", { n: m.firstResponseN })} />;
      case "resolution": return <Hero key={k} title={t("m.c.resolution")} value={fmtMin(t, m.resolutionMin)} hint={t("m.c.resolution.hint", { n: m.resolutionN })} />;
      case "after_hours": return <Hero key={k} title={t("m.c.after_hours")} value={num(m.afterHours)} hint={m.inbound ? t("m.c.after_hours.hint", { n: m.afterHours, total: m.inbound }) : t("m.none")} />;
      case "customers": return <Hero key={k} title={t("m.c.customers")} value={num(m.customers.new + m.customers.returning)} hint={`${num(m.customers.new)} ${t("m.c.customers.new")} · ${num(m.customers.returning)} ${t("m.c.customers.returning")}`} />;
      case "orders": return <Hero key={k} title={t("m.c.orders")} value={num(m.orders.found + m.orders.notFound)} hint={`${num(m.orders.found)} ${t("m.c.orders.found")} · ${num(m.orders.notFound)} ${t("m.c.orders.notFound")} · ${num(m.orders.other)} ${t("m.c.orders.other")}`} />;
      case "ai": return ai ? <Hero key={k} title={t("m.c.ai")} value={ai.noCap ? "—" : `${ai.percent}%`} hint={t("m.c.ai.hint", { used: num(ai.used), cap: num(ai.cap), cost: ai.costUsd.toFixed(4), per: ai.perConversationUsd == null ? "—" : `$${ai.perConversationUsd.toFixed(4)}` })} /> : null;
      case "per_day": return <Bars key={k} title={t("m.c.per_day")} rows={m.perDay.map((r) => ({ k: r.day, n: r.n }))} label={dayLabel} t={t} />;
      case "peak_hours": return <Bars key={k} title={t("m.c.peak_hours")} hint={t("m.c.peak_hours.hint", { tz: timeZone })} rows={m.peakHours.map((r) => ({ k: String(r.hour), n: r.n }))} label={(h) => `${h}h`} t={t} />;
      case "channels": return <Ranked key={k} title={t("m.c.channels")} rows={m.channels.map((r) => ({ label: t(`p.${r.channel}`) === `p.${r.channel}` ? r.channel : t(`p.${r.channel}`), n: r.n }))} t={t} />;
      case "handoff_reasons": return <Ranked key={k} title={t("m.c.handoff_reasons")} rows={m.handoffReasons.map((r) => ({ label: pick(r.reason, "r"), n: r.n }))} t={t} />;
      case "intents": return <Ranked key={k} title={t("m.c.intents")} rows={m.intents.map((r) => ({ label: pick(r.intent, "i"), n: r.n }))} t={t} />;
      case "agents": return (
        <Card key={k} className="p-4">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{t("m.c.agents")}</div>
          <ul className="space-y-1.5 text-sm">
            {m.agents.map((a) => <li key={a.userId} className="flex justify-between gap-2"><span className="truncate text-ink">{a.name}</span><span className="shrink-0 text-muted">{a.replies} {t("m.c.agents.replies")} · {a.assigned} {t("m.c.agents.assigned")}</span></li>)}
          </ul>
        </Card>
      );
      case "unanswered": return (
        <Card key={k} className="p-4 sm:col-span-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">{t("m.c.unanswered")}</div>
          <p className="mb-2 text-xs text-muted">{t("m.c.unanswered.hint")}</p>
          {m.unanswered.length === 0 ? <p className="text-sm text-muted">{t("m.none")}</p> : (
            <ul className="divide-y divide-line">
              {m.unanswered.map((u) => (
                <li key={`${u.conversationId}-${u.at}`} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                  <span className="min-w-0 flex-1 break-words text-ink">«{u.text}»</span>
                  <span className="flex shrink-0 gap-3 text-xs">
                    <Link href={`/inbox?c=${u.conversationId}`} className="text-muted underline">{t("m.c.unanswered.open")}</Link>
                    <Link href="/context" className="text-brand underline">{t("m.c.unanswered.add")}</Link>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      );
    }
  };
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" data-testid="metric-cards">{cards.map(card)}</div>;
}
