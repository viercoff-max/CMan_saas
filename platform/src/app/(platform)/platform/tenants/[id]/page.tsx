// /platform/tenants/[id]: one business for the platform admin (404 for anyone else, and for unknown ids).
// Counts and configuration only; the owner's contact is the platform's own customer record.
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card } from "@/components/ui";
import { getLocale, makeT } from "@/lib/i18n";
import { compactNumber } from "@/lib/platform/admin";
import { CHANGE_REASONS, loadTenantDetail, SUSPEND_REASONS } from "@/lib/platform/console";
import { consoleDict } from "@/lib/platform/console-dict";
import { actorLabel, ago, describeEvent, intlLocale, shortDate, usd } from "@/lib/platform/format";
import { DayBars, Kpi, Privacy, UsageBar } from "../../parts";
import { TenantActions } from "./TenantActions";

export const dynamic = "force-dynamic";

const STATUS_TONE = { active: "good", suspended: "bad", deleted: "neutral" } as const;
const CH_TONE = { connected: "good", error: "bad", disconnected: "neutral" } as const;

export default async function PlatformTenantPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const now = new Date();
  const v = await loadTenantDetail(decodeURIComponent(id), now);
  if (!v) notFound();
  const locale = await getLocale();
  const t = makeT(consoleDict, locale);
  const nf = new Intl.NumberFormat(intlLocale(locale));
  const x = v.tenant;
  const owner = v.members.find((m) => m.role === "owner");
  const count = (r: string) => v.members.filter((m) => m.role === r).length;
  const initials = x.name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

  return (
    <>
      <nav aria-label="breadcrumb" className="mb-3 text-sm text-muted">
        <Link href="/platform/tenants" className="underline underline-offset-2 hover:text-ink">{t("td.back")}</Link> <span aria-hidden="true">›</span> {x.name}
      </nav>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <span aria-hidden="true" className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-brand text-xl font-extrabold text-on-brand">{initials}</span>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-ink md:text-3xl">{x.name}</h1>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted">
              <Badge tone={STATUS_TONE[x.status] ?? "neutral"}>{t(`st.${x.status}`)}</Badge>
              {x.demo && <Badge tone="info">{t("tn.demo")}</Badge>}
              <span>{t(`plan.${x.plan}`)} · {t("td.since", { date: shortDate(x.createdAt, locale) })} · {t("td.address")}: <code className="font-mono text-ink">{x.slug}</code></span>
            </p>
          </div>
        </div>
        <TenantActions tenantId={x.id} name={x.name} slug={x.slug} status={x.status} plan={x.plan} cap={x.aiMonthlyTokenCap} aiPct={x.aiPct} demo={x.demo}
          suspendReasons={SUSPEND_REASONS} changeReasons={CHANGE_REASONS} />
      </div>

      {x.status === "suspended" && <p role="status" className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900">{t("td.suspended")}</p>}

      <section className="mb-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Kpi label={t("td.kpiConv")} value={nf.format(x.conversationsThisMonth)} hint={t("td.kpiConvHint")} />
        <Kpi label={t("td.kpiAi")} value={`${x.aiPct}%`} tone={x.aiPct >= 80 ? "warn" : undefined}
          hint={t("td.kpiAiHint", { used: compactNumber(x.aiTokensThisMonth), cap: compactNumber(x.aiMonthlyTokenCap), cost: usd(v.costMonth) })}>
          <UsageBar pct={x.aiPct} label={t("td.kpiAi")} />
        </Kpi>
        <Kpi label={t("td.kpiWaiting")} value={nf.format(v.stats.waiting)} tone={v.stats.urgent > 0 ? "bad" : undefined} hint={t("td.kpiWaitingHint", { n: v.stats.urgent })} />
        <Kpi label={t("td.kpiHolds")} value={nf.format(v.stats.legalHolds)} hint={t("td.kpiHoldsHint")} />
      </section>

      <section className="mb-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card>
          <h2 className="text-base font-semibold text-ink">{t("td.chart")}</h2>
          <DayBars days={v.stats.byDay} t={t} label={t("td.chart")} />
        </Card>
        <Card>
          <h2 className="mb-3 text-base font-semibold text-ink">{t("td.data")}</h2>
          <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">{t("td.owner")}</dt>
            <dd className="min-w-0 break-words text-ink">{owner ? <>{owner.name || t("none")}{owner.email && <> · <span className="font-mono text-xs">{owner.email}</span></>}</> : t("none")}</dd>
            <dt className="text-muted">{t("td.team")}</dt>
            <dd className="text-ink">{t("td.teamValue", { n: v.members.length, owners: count("owner"), admins: count("admin"), agents: count("agent") })}</dd>
            <dt className="text-muted">{t("td.channels")}</dt>
            <dd className="flex flex-wrap gap-1">
              {v.channels.length ? v.channels.map((c) => <Badge key={c.channel} tone={CH_TONE[c.status as keyof typeof CH_TONE] ?? "neutral"}>{t(`ch.${c.channel}`)} · {t(`chs.${c.status}`)}</Badge>) : <span className="text-muted">{t("ov.channelsNone")}</span>}
            </dd>
            <dt className="text-muted">{t("td.plan")}</dt><dd className="text-ink">{t(`plan.${x.plan}`)}</dd>
            <dt className="text-muted">{t("td.cap")}</dt><dd className="text-ink">{t("td.capValue", { cap: nf.format(x.aiMonthlyTokenCap) })}</dd>
            <dt className="text-muted">{t("td.last")}</dt><dd className="text-ink">{x.lastActivityAt ? ago(x.lastActivityAt, now, t) : t("tn.lastNever")}</dd>
          </dl>
        </Card>
      </section>

      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">{t("td.log")}</h2>
          <span className="text-xs text-muted">{t("td.logHint")}</span>
        </div>
        {v.log.length === 0 ? <p className="mt-3 text-sm text-muted">{t("td.logEmpty")}</p> : (
          <ul className="mt-2 divide-y divide-line">
            {v.log.map((r, i) => (
              <li key={`${r.createdAt}-${i}`} className="flex flex-wrap gap-x-4 gap-y-1 py-2.5 text-sm">
                <time dateTime={r.createdAt} className="min-w-32 text-xs text-muted">{shortDate(r.createdAt, locale, true)}</time>
                <span className="text-ink"><b className="font-semibold">{actorLabel(r.actor, r.action, v.admin.userId, t)}</b> · {describeEvent(r.action, r.detail, t)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Privacy t={t} />
    </>
  );
}
