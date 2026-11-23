// /platform/tenants: every business with filters. Platform admins only (404 otherwise). Counts only.
import Link from "next/link";
import { Badge, Card, inputCls } from "@/components/ui";
import { getLocale, makeT } from "@/lib/i18n";
import { aiLevel, compactNumber } from "@/lib/platform/admin";
import { loadTenants, TENANT_FILTERS, type TenantFilter, type TenantRow } from "@/lib/platform/console";
import { consoleDict } from "@/lib/platform/console-dict";
import { platformDict } from "@/lib/platform/dict";
import { ago, intlLocale, shortDate, type T } from "@/lib/platform/format";
import { Privacy } from "../parts";

export const dynamic = "force-dynamic";

const STATUS_TONE = { active: "good", suspended: "bad", deleted: "neutral" } as const;
const BAR = { ok: "bg-brand", high: "bg-amber-500", full: "bg-red-600" } as const;

function href(q: string, filter: TenantFilter, page = 1) {
  const p = new URLSearchParams();
  if (q) p.set("q", q);
  if (filter !== "all") p.set("filter", filter);
  if (page > 1) p.set("page", String(page));
  const s = p.toString();
  return s ? `/platform/tenants?${s}` : "/platform/tenants";
}

function AiCell({ x, ta }: { x: TenantRow; ta: T }) {
  return (
    <div className="min-w-40">
      <div className="flex items-center gap-2">
        <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={x.aiPct} aria-label={ta("admin.aiBar", { pct: x.aiPct })}
          className="h-2 flex-1 overflow-hidden rounded-full bg-canvas ring-1 ring-line">
          <div className={`h-full ${BAR[aiLevel(x.aiPct)]}`} style={{ width: `${x.aiPct}%` }} />
        </div>
        <span className="w-10 text-right text-xs tabular-nums text-ink">{x.aiPct}%</span>
      </div>
      <p className="mt-1 text-xs text-muted">{ta("admin.aiOf", { used: compactNumber(x.aiTokensThisMonth), cap: compactNumber(x.aiMonthlyTokenCap) })}</p>
      {x.aiPct >= 100 && <span className="sr-only">{ta("admin.capReached")}</span>}
    </div>
  );
}

export default async function PlatformTenantsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const now = new Date();
  const v = await loadTenants(await searchParams, now);
  const locale = await getLocale();
  const t = makeT(consoleDict, locale);
  const ta = makeT(platformDict, locale);
  const nf = new Intl.NumberFormat(intlLocale(locale));

  return (
    <>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-ink">{t("tn.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">{t("tn.subtitle")}</p>
      </div>

      <Card className="p-0">
        <div className="flex flex-wrap items-end gap-3 border-b border-line p-4">
          <form method="get" action="/platform/tenants" role="search" className="flex min-w-0 flex-1 basis-72 flex-wrap items-end gap-2">
            {v.filter !== "all" && <input type="hidden" name="filter" value={v.filter} />}
            <label className="min-w-0 flex-1 basis-56">
              <span className="mb-1 block text-sm font-medium text-ink">{t("tn.search")}</span>
              <input type="search" name="q" defaultValue={v.q} maxLength={100} placeholder={t("tn.searchPlaceholder")} className={inputCls} />
            </label>
            <button type="submit" className="min-h-11 rounded-xl bg-brand px-4 py-2 text-sm font-medium text-on-brand hover:bg-brand-dark">{t("tn.searchBtn")}</button>
            {v.q && <Link href={href("", v.filter)} className="inline-flex min-h-11 items-center px-2 text-sm text-muted underline underline-offset-2 hover:text-ink">{t("tn.clear")}</Link>}
          </form>
          <nav aria-label={t("tn.filtersLabel")} className="flex flex-wrap gap-2">
            {TENANT_FILTERS.map((f) => (
              <Link key={f} href={href(v.q, f)} aria-current={v.filter === f ? "page" : undefined}
                className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-sm font-medium ${v.filter === f ? "border-ink bg-ink text-white" : "border-line bg-surface text-ink hover:bg-canvas"}`}>
                {t(`f.${f}`)} <span className={`text-xs ${v.filter === f ? "text-white/80" : "text-muted"}`}>{v.counts[f]}</span>
              </Link>
            ))}
          </nav>
        </div>

        {v.items.length === 0 ? (
          <p role="status" className="p-8 text-center text-sm text-muted">{t("tn.empty")}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[64rem] text-left text-sm">
              <caption className="sr-only">{ta("admin.caption")}</caption>
              <thead className="bg-canvas text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">{ta("admin.colBusiness")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{ta("admin.colPlan")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{ta("admin.colStatus")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{ta("admin.colChannels")}</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">{ta("admin.colConv")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{ta("admin.colAi")}</th>
                  <th scope="col" className="px-4 py-3 text-right font-semibold">{ta("admin.colTeam")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t("tn.colLast")}</th>
                  <th scope="col" className="px-4 py-3"><span className="sr-only">{t("open")}</span></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {v.items.map((x) => (
                  <tr key={x.id}>
                    <th scope="row" className="px-4 py-3 font-normal">
                      <Link href={`/platform/tenants/${encodeURIComponent(x.id)}`} className="block font-semibold text-ink hover:underline">{x.name}</Link>
                      <span className="block text-xs text-muted">{x.slug} · {ta("admin.since", { date: shortDate(x.createdAt, locale) })}</span>
                    </th>
                    <td className="px-4 py-3"><Badge>{t(`plan.${x.plan}`)}</Badge></td>
                    <td className="px-4 py-3">
                      <span className="flex flex-wrap gap-1">
                        <Badge tone={STATUS_TONE[x.status] ?? "neutral"}>{t(`st.${x.status}`)}</Badge>
                        {x.demo && <Badge tone="info">{t("tn.demo")}</Badge>}
                        {x.aiPct >= 100 && <Badge tone="warn">{ta("admin.capReached")}</Badge>}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {x.connectedChannels > 0
                        ? <Badge tone="info">{ta("admin.channels", { n: x.connectedChannels })}</Badge>
                        : <span className="text-xs text-muted">{ta("admin.noChannels")}</span>}
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums text-ink">{nf.format(x.conversationsThisMonth)}</td>
                    <td className="px-4 py-3"><AiCell x={x} ta={ta} /></td>
                    <td className="px-4 py-3 text-right tabular-nums text-ink">{nf.format(x.members)}</td>
                    <td className="px-4 py-3 text-sm text-muted">{x.lastActivityAt ? ago(x.lastActivityAt, now, t) : t("tn.lastNever")}</td>
                    <td className="px-4 py-3">
                      <Link href={`/platform/tenants/${encodeURIComponent(x.id)}`} className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-brand hover:bg-canvas">
                        {t("open")}<span className="sr-only"> {x.name}</span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {v.pages > 1 && (
          <nav aria-label={ta("admin.pagination")} className="flex flex-wrap items-center justify-between gap-2 border-t border-line p-4 text-sm">
            <span className="text-muted">{ta("admin.pageOf", { page: v.page, pages: v.pages })}</span>
            <span className="flex gap-2">
              {v.page > 1 && <Link rel="prev" href={href(v.q, v.filter, v.page - 1)} className="min-h-11 rounded-xl border border-line px-4 py-2.5 text-ink hover:bg-canvas">{ta("admin.prev")}</Link>}
              {v.page < v.pages && <Link rel="next" href={href(v.q, v.filter, v.page + 1)} className="min-h-11 rounded-xl border border-line px-4 py-2.5 text-ink hover:bg-canvas">{ta("admin.next")}</Link>}
            </span>
          </nav>
        )}
      </Card>
      <Privacy t={t} />
    </>
  );
}
