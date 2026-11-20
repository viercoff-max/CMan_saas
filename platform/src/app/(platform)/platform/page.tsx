// /platform: tenant overview for platform admins (read-only). Everyone else: 404 (see lib/platform/admin.ts).
// Shows counts only: never message text or end-customer data.
import Link from "next/link";
import { getLocale, makeT } from "@/lib/i18n";
import type { Locale } from "@/lib/i18n-shared";
import type { TenantOverview } from "@/lib/data/types";
import { Badge, Card, inputCls } from "@/components/ui";
import { aiLevel, aiPercent, compactNumber, loadPlatformView, needsAttention } from "@/lib/platform/admin";
import { PLATFORM_BRAND } from "@/lib/platform/brand";
import { platformDict } from "@/lib/platform/dict";

export const dynamic = "force-dynamic";

type T = ReturnType<typeof makeT>;
const intlLocale = (l: Locale) => (l === "en" ? "en-US" : "es-MX");

function monthLabel(period: string, locale: Locale) {
  const d = new Date(`${period}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return period;
  return new Intl.DateTimeFormat(intlLocale(locale), { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
}
function sinceLabel(createdAt: string, locale: Locale) {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), { month: "short", year: "numeric", timeZone: "UTC" }).format(d);
}

const STATUS_TONE = { active: "good", suspended: "warn", deleted: "bad" } as const;
const BAR = { ok: "bg-brand", high: "bg-amber-500", full: "bg-red-600" } as const;

function pageHref(q: string, page: number) {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (page > 1) p.set("page", String(page));
  const s = p.toString();
  return s ? `/platform?${s}` : "/platform";
}

function AiCell({ tenant, t, locale }: { tenant: TenantOverview; t: T; locale: Locale }) {
  const pct = aiPercent(tenant);
  const level = aiLevel(pct);
  const nf = new Intl.NumberFormat(intlLocale(locale));
  return (
    <div className="min-w-40">
      <div className="flex items-center gap-2">
        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t("admin.aiBar", { pct })}
          className="h-2 flex-1 overflow-hidden rounded-full bg-canvas ring-1 ring-line">
          <div className={`h-full ${BAR[level]}`} style={{ width: `${pct}%` }} />
        </div>
        <span className="w-10 text-right text-xs tabular-nums text-ink">{pct}%</span>
      </div>
      <p className="mt-1 text-xs text-muted" title={`${nf.format(tenant.aiTokensThisMonth)} / ${nf.format(tenant.aiMonthlyTokenCap)}`}>
        {t("admin.aiOf", { used: compactNumber(tenant.aiTokensThisMonth), cap: compactNumber(tenant.aiMonthlyTokenCap) })}
      </p>
    </div>
  );
}

function Kpi({ label, value, hint, warn }: { label: string; value: string; hint: string; warn?: boolean }) {
  return (
    <Card className={warn ? "border-amber-300" : undefined}>
      <p className={`text-xs font-semibold uppercase tracking-wide ${warn ? "text-warn" : "text-muted"}`}>{label}</p>
      <p className="mt-2 text-3xl font-bold tabular-nums text-ink">{value}</p>
      <p className="mt-1 text-sm text-muted">{hint}</p>
    </Card>
  );
}

export default async function PlatformPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const view = await loadPlatformView(await searchParams);
  const locale = await getLocale();
  const t = makeT(platformDict, locale);
  const nf = new Intl.NumberFormat(intlLocale(locale));
  const { list, query, pages } = view;
  const month = monthLabel(list.period, locale);
  const convOnPage = list.items.reduce((s, x) => s + x.conversationsThisMonth, 0);
  const attention = list.items.filter(needsAttention).length;

  return (
    <>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-ink">{t("admin.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">{t("admin.subtitle", { brand: PLATFORM_BRAND.name })}</p>
      </div>

      <section aria-label={t("admin.title")} className="mb-6 grid gap-4 sm:grid-cols-3">
        <Kpi label={t("admin.kpiTotal")} value={nf.format(list.total)} hint={query.q ? t("admin.results", { total: nf.format(list.total) }) : t("admin.kpiTotalHint")} />
        <Kpi label={t("admin.kpiConv", { month })} value={nf.format(convOnPage)} hint={t("admin.kpiOnPage")} />
        <Kpi label={t("admin.kpiAttention")} value={nf.format(attention)} hint={t("admin.kpiAttentionHint")} warn={attention > 0} />
      </section>

      <Card className="p-0">
        <form method="get" action="/platform" role="search" className="flex flex-wrap items-end gap-2 border-b border-line p-4">
          <label className="min-w-0 flex-1 basis-64">
            <span className="mb-1 block text-sm font-medium text-ink">{t("admin.search")}</span>
            <input type="search" name="q" defaultValue={query.q} maxLength={100} placeholder={t("admin.searchPlaceholder")} className={inputCls} />
          </label>
          <button type="submit" className="min-h-11 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:bg-brand-dark">{t("admin.searchBtn")}</button>
          {query.q && <Link href="/platform" className="min-h-11 rounded-xl px-3 py-2.5 text-sm text-muted underline underline-offset-2 hover:text-ink">{t("admin.clear")}</Link>}
        </form>

        {list.items.length === 0 ? (
          <p role="status" className="p-8 text-center text-sm text-muted">
            {query.q ? t("admin.emptySearch", { q: query.q }) : t("admin.empty")}
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[60rem] text-left text-sm">
              <caption className="sr-only">{t("admin.caption")}</caption>
              <thead className="bg-canvas text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">{t("admin.colBusiness")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t("admin.colPlan")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t("admin.colStatus")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t("admin.colChannels")}</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">{t("admin.colConv")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t("admin.colAi")}</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">{t("admin.colTeam")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {list.items.map((x) => (
                  <tr key={x.id}>
                    <th scope="row" className="px-4 py-3 font-normal">
                      <span className="block font-semibold text-ink">{x.name}</span>
                      <span className="block text-xs text-muted">{x.slug} · {t("admin.since", { date: sinceLabel(x.createdAt, locale) })}</span>
                    </th>
                    <td className="px-4 py-3"><Badge>{t(`admin.plan.${x.plan}`)}</Badge></td>
                    <td className="px-4 py-3">
                      <span className="flex flex-wrap gap-1">
                        <Badge tone={STATUS_TONE[x.status] ?? "neutral"}>{t(`admin.status.${x.status}`)}</Badge>
                        {aiPercent(x) >= 100 && <Badge tone="warn">{t("admin.capReached")}</Badge>}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {x.connectedChannels > 0
                        ? <Badge tone="info">{t("admin.channels", { n: x.connectedChannels })}</Badge>
                        : <span className="text-xs text-muted">{t("admin.noChannels")}</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-ink">{nf.format(x.conversationsThisMonth)}</td>
                    <td className="px-4 py-3"><AiCell tenant={x} t={t} locale={locale} /></td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink">{nf.format(x.members)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pages > 1 && (
          <nav aria-label={t("admin.pagination")} className="flex flex-wrap items-center justify-between gap-2 border-t border-line p-4 text-sm">
            <span className="text-muted">{t("admin.pageOf", { page: query.page, pages })}</span>
            <span className="flex gap-2">
              {query.page > 1 && <Link rel="prev" href={pageHref(query.q, query.page - 1)} className="min-h-11 rounded-xl border border-line px-4 py-2.5 text-ink hover:bg-canvas">{t("admin.prev")}</Link>}
              {query.page < pages && <Link rel="next" href={pageHref(query.q, query.page + 1)} className="min-h-11 rounded-xl border border-line px-4 py-2.5 text-ink hover:bg-canvas">{t("admin.next")}</Link>}
            </span>
          </nav>
        )}
      </Card>

      <p className="mt-4 text-xs text-muted">{t("admin.privacy")} {t("admin.month", { month })}</p>
    </>
  );
}
