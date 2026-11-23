// /platform/audit: what platform admins did plus privacy / demo events, newest first. Platform admins only.
import Link from "next/link";
import { Card } from "@/components/ui";
import { getLocale, makeT } from "@/lib/i18n";
import { loadAuditLog } from "@/lib/platform/console";
import { consoleDict } from "@/lib/platform/console-dict";
import { actorLabel, describeEvent, shortDate } from "@/lib/platform/format";
import { Privacy } from "../parts";

export const dynamic = "force-dynamic";

export default async function PlatformAuditPage() {
  const v = await loadAuditLog();
  const locale = await getLocale();
  const t = makeT(consoleDict, locale);
  return (
    <>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-ink">{t("au.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">{t("au.subtitle")}</p>
      </div>
      <Card className="p-0">
        {v.rows.length === 0 ? <p role="status" className="p-6 text-sm text-muted">{t("au.empty")}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-left text-sm">
              <caption className="sr-only">{t("au.title")}</caption>
              <thead className="bg-canvas text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">{t("au.colWhen")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t("au.colWho")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t("au.colBusiness")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t("au.colWhat")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {v.rows.map((r, i) => (
                  <tr key={`${r.createdAt}-${i}`}>
                    <td className="whitespace-nowrap px-4 py-3 text-muted"><time dateTime={r.createdAt}>{shortDate(r.createdAt, locale, true)}</time></td>
                    <td className="px-4 py-3 text-ink">{actorLabel(r.actor, r.action, v.admin.userId, t)}</td>
                    <td className="px-4 py-3">{r.tenantId ? <Link href={`/platform/tenants/${encodeURIComponent(r.tenantId)}`} className="text-ink hover:underline">{r.tenantName}</Link> : <span className="text-muted">{t("none")}</span>}</td>
                    <td className="px-4 py-3 text-ink">{describeEvent(r.action, r.detail, t)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Privacy t={t} />
    </>
  );
}
