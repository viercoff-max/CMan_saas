// /platform/compliance: privacy requests handled (from the audit log) and legal-hold cases. Platform admins only.
// Metadata only: no message text, no customer names or contact data.
import Link from "next/link";
import { Badge, Card } from "@/components/ui";
import { LEGAL_HOLD_LIFT_REASONS } from "@/lib/data/types";
import { getLocale, makeT } from "@/lib/i18n";
import { loadCompliance } from "@/lib/platform/console";
import { consoleDict } from "@/lib/platform/console-dict";
import { intlLocale, shortDate } from "@/lib/platform/format";
import { Kpi, Privacy } from "../parts";
import { LiftHold } from "./LiftHold";

export const dynamic = "force-dynamic";

export default async function PlatformCompliancePage() {
  const v = await loadCompliance();
  const locale = await getLocale();
  const t = makeT(consoleDict, locale);
  const nf = new Intl.NumberFormat(intlLocale(locale));
  const holdTenants = new Set(v.holds.map((h) => h.tenantId)).size;
  const oldest = v.holds.reduce((m, h) => Math.max(m, h.ageDays), 0);
  const reqType = (a: string) => (t(`req.${a}`) !== `req.${a}` ? t(`req.${a}`) : t("req.other"));
  const origin = (actor: string) => t(actor === "meta-deletion" ? "origin.meta" : actor === "system" ? "origin.system" : "origin.team");

  return (
    <>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-ink">{t("cp.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">{t("cp.subtitle")}</p>
      </div>

      <section className="mb-4 grid gap-4 sm:grid-cols-3">
        <Kpi label={t("cp.kpiRequests")} value={nf.format(v.requestsThisMonth)} hint={t("cp.kpiRequestsHint")} />
        <Kpi label={t("cp.kpiHolds")} value={nf.format(v.holds.length)} tone={v.holds.length ? "warn" : undefined}
          hint={v.holds.length ? t("cp.kpiHoldsHint", { n: holdTenants, days: oldest }) : t("cp.kpiHoldsNone")} />
        <Kpi label={t("cp.kpiPurge")} value={t("cp.kpiPurgeValue", { days: v.retentionDays })} hint={t("cp.kpiPurgeHint")} />
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card className="p-0">
          <div className="border-b border-line p-4">
            <h2 className="text-base font-semibold text-ink">{t("cp.requests")}</h2>
            <p className="mt-1 text-sm text-muted">{t("cp.requestsHint")}</p>
          </div>
          {v.requests.length === 0 ? <p role="status" className="p-6 text-sm text-muted">{t("cp.requestsEmpty")}</p> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <thead className="bg-canvas text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-semibold">{t("cp.colDate")}</th>
                    <th scope="col" className="px-4 py-3 font-semibold">{t("cp.colOrigin")}</th>
                    <th scope="col" className="px-4 py-3 font-semibold">{t("cp.colBusiness")}</th>
                    <th scope="col" className="px-4 py-3 font-semibold">{t("cp.colType")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {v.requests.map((r, i) => (
                    <tr key={`${r.createdAt}-${i}`}>
                      <td className="px-4 py-3 text-muted">{shortDate(r.createdAt, locale)}</td>
                      <td className="px-4 py-3"><Badge tone={r.actor === "meta-deletion" ? "info" : "neutral"}>{origin(r.actor)}</Badge></td>
                      <td className="px-4 py-3">{r.tenantId ? <Link href={`/platform/tenants/${encodeURIComponent(r.tenantId)}`} className="text-ink hover:underline">{r.tenantName}</Link> : r.tenantName}</td>
                      <td className="px-4 py-3 text-ink">{reqType(r.action)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="text-base font-semibold text-ink">{t("cp.holds")}</h2>
          <p className="mt-1 text-sm text-muted">{t("cp.holdsHint")}</p>
          {v.holds.length === 0 ? <p role="status" className="mt-3 text-sm text-muted">{t("cp.holdsEmpty")}</p> : (
            <ul className="mt-2 divide-y divide-line">
              {v.holds.map((h) => {
                const label = `${h.tenantName} · ${t("cp.holdItem", { channel: t(`ch.${h.channel}`), reason: t(`hr.${h.reason === "safety" || h.reason === "legal" ? h.reason : "none"}`), days: h.ageDays })}`;
                return (
                  <li key={h.conversationId} className="flex items-start gap-3 py-3">
                    <span aria-hidden="true" className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${h.reason === "legal" ? "bg-amber-500" : "bg-red-600"}`} />
                    <div className="min-w-0 flex-1">
                      <Link href={`/platform/tenants/${encodeURIComponent(h.tenantId)}`} className="font-semibold text-ink hover:underline">{h.tenantName}</Link>
                      <p className="text-sm text-muted">{t("cp.holdItem", { channel: t(`ch.${h.channel}`), reason: t(`hr.${h.reason === "safety" || h.reason === "legal" ? h.reason : "none"}`), days: h.ageDays })}</p>
                    </div>
                    <LiftHold tenantId={h.tenantId} conversationId={h.conversationId} label={label} reasons={LEGAL_HOLD_LIFT_REASONS} />
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </section>
      <Privacy t={t} />
    </>
  );
}
