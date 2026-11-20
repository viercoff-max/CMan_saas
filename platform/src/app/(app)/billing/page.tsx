// Plan y uso (every member can view): plan, this month's AI usage against the cap, conversations, team size and
// the plans table with placeholder prices. No checkout: billing is not active yet (mockup 13).
import { Badge, Card, Meter, PageHeader } from "@/components/ui";
import { requireMemberPage } from "@/components/guards";
import { getLocale, makeT } from "@/lib/i18n";
import { getData } from "@/lib/data";
import type { TenantPlan } from "@/lib/data/types";
import { loadUsageSummary } from "./data";
import { billingDict } from "./dict";
import { fmtDate, fmtMonth, fmtNum } from "./usage";
import { contactEmail } from "@/lib/platform/brand";

export const dynamic = "force-dynamic";

const PLANS: TenantPlan[] = ["free", "pro", "business"];

export default async function BillingPage() {
  const s = await requireMemberPage();
  const locale = await getLocale();
  const t = makeT(billingDict, locale);
  const now = new Date();
  const [u, members] = await Promise.all([loadUsageSummary(s.tenantId, now), getData().members.list(s.tenantId)]);
  const renews = fmtDate(u.renewsAt, locale);
  const num = (v: number) => fmtNum(v, locale);
  const aiText = u.ai.noCap ? t("ai.none") : t("ai.value", { p: u.ai.percent });

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <p className="mb-4 rounded-xl border border-line bg-surface px-4 py-3 text-sm text-ink" role="note">💳 {t("notice")}</p>

      <Card className="mb-6">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">{t("usage.title", { month: fmtMonth(now, locale) })}</h2>
          <span className="text-sm text-muted">{t("usage.renews", { date: renews })}</span>
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium text-ink">{t("conv")}</span>
              <span className="text-sm font-semibold text-ink">{u.conversationsCapped ? t("conv.capped", { n: num(u.conversations) }) : num(u.conversations)}</span>
            </div>
            <p className="mt-2 text-xs text-muted">{t("conv.hint")}</p>
          </div>
          <div>
            <div className="mb-2 flex items-baseline justify-between gap-2">
              <span className="font-medium text-ink">{t("ai")}</span>
              <span className="text-sm text-ink"><strong>{u.ai.noCap ? "—" : `${u.ai.percent}%`}</strong></span>
            </div>
            <Meter percent={u.ai.percent} label={t("ai.meter")} valueText={aiText} tone={u.ai.overCap || u.ai.noCap ? "bad" : "brand"} />
            {!u.ai.noCap && (
              <p className="mt-2 text-xs text-muted">{t("ai.detail", { used: num(u.ai.used), cap: num(u.ai.cap), remaining: num(u.ai.remaining) })}</p>
            )}
            <p className={`mt-1 text-xs ${u.ai.overCap || u.ai.noCap ? "text-danger" : "text-muted"}`} role={u.ai.overCap ? "status" : undefined}>
              {u.ai.noCap ? t("ai.none") : u.ai.overCap ? t("ai.over", { date: renews }) : t("ai.hint")}
            </p>
          </div>
          <div>
            <div className="flex items-baseline justify-between gap-2">
              <span className="font-medium text-ink">{t("team")}</span>
              <span className="text-sm font-semibold text-ink">{num(members.length)}</span>
            </div>
            <p className="mt-2 text-xs text-muted">{t("team.hint")}</p>
          </div>
        </div>
      </Card>

      <h2 className="mb-3 text-base font-semibold text-ink">{t("plans")}</h2>
      <ul className="grid gap-4 md:grid-cols-3">
        {PLANS.map((p) => {
          const mine = p === u.plan;
          return (
            <li key={p} className={`rounded-2xl border bg-surface p-5 shadow-sm ${mine ? "border-2 border-brand" : "border-line"}`} aria-current={mine ? "true" : undefined}>
              <div className="flex items-start justify-between gap-2">
                <h3 className="text-xl font-semibold text-ink [font-family:var(--heading-font)]">{t(`plan.${p}`)}</h3>
                {mine && <Badge tone="info">{t("plan.yours")}</Badge>}
              </div>
              <p className="mt-2 text-sm text-muted">{t(`plan.${p}.desc`)}</p>
              <p className="mt-3 text-lg font-semibold text-muted">{t("plan.price")}</p>
              <ul className="mt-3 space-y-2 text-sm text-ink">
                {[1, 2, 3, 4].map((i) => <li key={i} className="flex gap-2"><span aria-hidden className="text-ok">✓</span>{t(`plan.${p}.f${i}`)}</li>)}
              </ul>
              {mine && <p className="mt-4 rounded-xl border border-line px-3 py-2 text-center text-sm text-muted">{t("plan.current")}</p>}
            </li>
          );
        })}
      </ul>
      <PlanChange t={t} />
    </>
  );
}

/** "Para cambiar de plan, escríbenos a <mailto>" when the platform contact is configured (lib/platform/brand.ts). */
function PlanChange({ t }: { t: (k: string, v?: Record<string, string | number>) => string }) {
  const email = contactEmail();
  if (!email) return <p className="mt-4 text-sm text-muted">{t("plan.changeSoon")}</p>;
  const [before, after] = t("plan.change", { email: "@@EMAIL@@" }).split("@@EMAIL@@");
  return <p className="mt-4 text-sm text-muted">{before}<a className="font-medium text-brand underline underline-offset-2" href={`mailto:${email}`}>{email}</a>{after}</p>;
}
