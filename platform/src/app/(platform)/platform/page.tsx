// /platform: overview of the whole platform for platform admins. Everyone else: 404 (lib/platform/admin.ts).
// Counts only: never message text or end-customer data.
import Link from "next/link";
import { Card } from "@/components/ui";
import { getLocale, makeT } from "@/lib/i18n";
import { compactNumber } from "@/lib/platform/admin";
import { loadOverview } from "@/lib/platform/console";
import { consoleDict } from "@/lib/platform/console-dict";
import { ago, intlLocale, usd } from "@/lib/platform/format";
import { DayBars, Kpi, Privacy, UsageBar } from "./parts";

export const dynamic = "force-dynamic";

const SEV = { bad: "bg-red-600", warn: "bg-amber-500", info: "bg-indigo-500" } as const;

export default async function PlatformOverviewPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const now = new Date();
  const v = await loadOverview(await searchParams, now);
  const locale = await getLocale();
  const t = makeT(consoleDict, locale);
  const nf = new Intl.NumberFormat(intlLocale(locale));
  const s = v.stats;
  const aiPct = v.aiDailyCap > 0 ? Math.min(100, Math.floor((v.aiTodayTokens / v.aiDailyCap) * 100)) : 100;
  const connected = s.channels.filter((c) => c.status === "connected");
  const errors = s.channels.filter((c) => c.status === "error").reduce((n, c) => n + c.count, 0);
  const plans = [["free", s.tenants.free], ["pro", s.tenants.pro], ["business", s.tenants.business]] as const;
  const planTotal = Math.max(1, plans.reduce((n, [, c]) => n + c, 0));
  const PLAN_BG = { free: "bg-[#9DB9B4]", pro: "bg-brand", business: "bg-[#10201E]" } as const;

  return (
    <>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-ink">{t("ov.title")}</h1>
          <p className="mt-1 text-sm text-muted">{t("ov.subtitle")}</p>
        </div>
        <nav aria-label={t("ov.periodLabel")} className="flex gap-2">
          {([7, 30] as const).map((d) => (
            <Link key={d} href={d === 7 ? "/platform" : "/platform?days=30"} aria-current={v.days === d ? "page" : undefined}
              className={`inline-flex min-h-11 items-center rounded-full border px-4 text-sm font-medium ${v.days === d ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink hover:bg-canvas"}`}>
              {t(d === 7 ? "ov.days7" : "ov.days30")}
            </Link>
          ))}
        </nav>
      </div>

      <section className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label={t("ov.kpiActive")} value={nf.format(v.activeTenants)} hint={t("ov.kpiActiveHint", { n: v.newTenants, demo: v.demoTenants })} />
        <Kpi label={t("ov.kpiConv", { days: v.days })} value={nf.format(v.conversations)} hint={t("ov.kpiConvHint")} />
        <Kpi label={t("ov.kpiAi")} value={`${aiPct}%`} tone={aiPct >= 80 ? "warn" : undefined}
          hint={t("ov.kpiAiHint", { used: compactNumber(v.aiTodayTokens), cap: compactNumber(v.aiDailyCap) })}>
          <UsageBar pct={aiPct} label={t("ov.kpiAi")} />
        </Kpi>
        <Kpi label={t("ov.kpiUrgent")} value={nf.format(s.urgent)} tone={s.urgent > 0 ? "bad" : undefined}
          hint={s.urgent > 0 ? t("ov.kpiUrgentHint", { n: s.urgentTenants, ago: ago(s.oldestUrgentAt, now, t) }) : `${t("ov.kpiUrgentNone")} · ${t("ov.kpiWaitingHint", { n: s.waiting })}`} />
      </section>

      <section className="mb-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-semibold text-ink">{t("ov.chart")}</h2>
            <span className="text-xs text-muted">{t("ov.chartDays", { days: v.days })} · {t("ov.chartTotal", { n: nf.format(v.conversations) })}</span>
          </div>
          <DayBars days={s.byDay} t={t} label={`${t("ov.chart")} · ${t("ov.chartTotal", { n: v.conversations })}`} />
          <p className="mt-3 text-sm text-ink">{t("ov.cost", { cost: usd(v.costMonth), proj: usd(v.costProjection) })}</p>
          <p className="text-xs text-muted">{t("ov.costNote")}</p>
        </Card>
        <Card>
          <h2 className="text-base font-semibold text-ink">{t("ov.alerts")}</h2>
          {v.alerts.length === 0 ? (
            <p role="status" className="mt-3 text-sm text-muted">{t("ov.alertsNone")}</p>
          ) : (
            <ul className="mt-2 divide-y divide-line">
              {v.alerts.map((a, i) => (
                <li key={`${a.kind}-${a.tenantId}-${i}`} className="flex items-start gap-3 py-3">
                  <span aria-hidden="true" className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${SEV[a.severity]}`} />
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-ink">{a.tenantName}</p>
                    <p className="text-sm text-muted">{t(`alert.${a.kind}`, { channel: t(`ch.${a.channel ?? ""}`), pct: a.pct ?? 0, days: a.days ?? 0 })}</p>
                  </div>
                  <Link href={`/platform/tenants/${encodeURIComponent(a.tenantId)}`} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-brand hover:bg-canvas">
                    {t("view")}<span className="sr-only"> {a.tenantName}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t("ov.byPlan")}</p>
          <p className="mt-2 text-sm text-ink">{plans.map(([p, n]) => `${t(`plan.${p}`)} ${n}`).join(" · ")}</p>
          <div aria-hidden="true" className="mt-2 flex h-2 gap-[2px] overflow-hidden rounded-full">
            {plans.filter(([, n]) => n > 0).map(([p, n]) => <span key={p} className={PLAN_BG[p]} style={{ width: `${(n / planTotal) * 100}%` }} />)}
          </div>
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t("ov.channels")}</p>
          <p className="mt-2 text-sm text-ink">{connected.length ? connected.map((c) => `${t(`ch.${c.channel}`)} ${c.count}`).join(" · ") : t("ov.channelsNone")}</p>
          {errors > 0 && <p className="mt-1 text-xs text-danger">{t("ov.channelsErr", { n: errors })}</p>}
        </Card>
        <Card>
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t("ov.holds")}</p>
          <p className="mt-2 text-sm text-ink">{t("ov.holdsHint", { n: s.legalHolds, t: s.legalHoldTenants })}</p>
          <Link href="/platform/compliance" className="mt-1 inline-flex min-h-11 items-center text-sm font-medium text-brand underline-offset-2 hover:underline">{t("nav.compliance")}</Link>
        </Card>
      </section>
      <Privacy t={t} />
    </>
  );
}
