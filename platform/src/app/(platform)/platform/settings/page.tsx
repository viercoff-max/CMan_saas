// /platform/settings: how the platform is configured (read only). Platform admins only.
// Integrations show configured / not configured: never a key, a prefix or its length.
import { Badge, Card } from "@/components/ui";
import { getLocale, makeT } from "@/lib/i18n";
import { loadSettings, type SettingState } from "@/lib/platform/console";
import { consoleDict } from "@/lib/platform/console-dict";
import { intlLocale, shortDate } from "@/lib/platform/format";
import { Privacy } from "../parts";

export const dynamic = "force-dynamic";

const TONE: Record<SettingState, "good" | "neutral" | "warn"> = { ok: "good", missing: "neutral", warn: "warn" };

function Row({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="py-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-0.5 font-semibold text-ink">{value}</dd>
      {hint && <dd className="mt-0.5 text-sm text-muted">{hint}</dd>}
    </div>
  );
}

export default async function PlatformSettingsPage() {
  const v = await loadSettings();
  const locale = await getLocale();
  const t = makeT(consoleDict, locale);
  const nf = new Intl.NumberFormat(intlLocale(locale));
  const tokens = (n: number) => t("cf.tokens", { n: nf.format(n) });
  const days = (n: number) => t("cf.days", { n });
  const stateLabel = (key: string, state: SettingState) => {
    const own = t(`in.${key}.${state}`);
    return own !== `in.${key}.${state}` ? own : t(`is.${state}`);
  };

  return (
    <>
      <div className="mb-6">
        <h1 className="text-3xl font-bold tracking-tight text-ink">{t("cf.title")}</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">{t("cf.subtitle")}</p>
      </div>

      <Card className="mb-4 p-0">
        <div className="border-b border-line p-4">
          <h2 className="text-base font-semibold text-ink">{t("cf.admins")}</h2>
          <p className="mt-1 text-sm text-muted">{t("cf.adminsHint")}</p>
        </div>
        {v.admins.length === 0 ? <p role="status" className="p-6 text-sm text-muted">{t("cf.adminsEmpty")}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <caption className="sr-only">{t("cf.admins")}</caption>
              <thead className="bg-canvas text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">{t("cf.colName")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t("cf.colEmail")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t("cf.colSince")}</th>
                  <th scope="col" className="px-4 py-3 font-semibold">{t("cf.colId")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {v.admins.map((a) => (
                  <tr key={a.userId}>
                    <td className="px-4 py-3 text-ink">{a.name || t("none")} {a.userId === v.admin.userId && <span className="text-muted">{t("cf.you")}</span>}</td>
                    <td className="px-4 py-3 text-ink">{a.email || t("none")}</td>
                    <td className="px-4 py-3 text-muted">{a.since ? shortDate(a.since, locale) : t("none")}</td>
                    <td className="px-4 py-3"><code className="break-all text-xs text-muted">{a.userId}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="border-t border-line p-4 text-sm text-muted">
          {v.backend === "supabase" ? (
            <>
              <p>{t("cf.adminsHow")}</p>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-canvas p-3 text-xs text-ink"><code>{"insert into public.platform_admins (user_id) values ('<ID>');"}</code></pre>
              <p className="mt-2">{t("cf.adminsHowRemove")}</p>
              <pre className="mt-2 overflow-x-auto rounded-lg bg-canvas p-3 text-xs text-ink"><code>{"delete from public.platform_admins where user_id = '<ID>';"}</code></pre>
            </>
          ) : <p>{t("cf.adminsHowLocal")}</p>}
        </div>
      </Card>

      <section className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="text-base font-semibold text-ink">{t("cf.ai")}</h2>
          <dl className="mt-1 divide-y divide-line">
            <Row label={t("cf.provider")} value={t(`prov.${v.ai.provider}`)} />
            <Row label={t("cf.model")} value={<code className="text-sm">{v.ai.model}</code>} />
            <Row label={t("cf.dailyCap")} value={tokens(v.ai.dailyCap)} hint={t("cf.dailyCapHint", { used: nf.format(v.ai.reservedToday) })} />
            <Row label={t("cf.newCap")} value={tokens(v.ai.newTenantCap)} hint={t("cf.newCapHint")} />
            <Row label={t("cf.prices")} value={t("cf.pricesValue", { input: v.ai.prices.input.toFixed(2), output: v.ai.prices.output.toFixed(2) })}
              hint={t(v.ai.customPrices ? "cf.pricesCustom" : "cf.pricesDefault")} />
          </dl>
        </Card>

        <Card>
          <h2 className="text-base font-semibold text-ink">{t("cf.retention")}</h2>
          <dl className="mt-1 divide-y divide-line">
            <Row label={t("cf.retConv")} value={days(v.retention.conversations)} hint={t("cf.retConvHint")} />
            <Row label={t("cf.retMask")} value={days(v.retention.legalHoldMask)} hint={t("cf.retMaskHint")} />
            <Row label={t("cf.retOutbox")} value={days(v.retention.outbox)} hint={t("cf.retOutboxHint")} />
          </dl>
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="text-base font-semibold text-ink">{t("cf.integrations")}</h2>
          <p className="mt-1 text-sm text-muted">{t("cf.integrationsHint")} {t("cf.backend", { b: v.backend === "supabase" ? "Supabase" : "SQLite" })}</p>
          <ul className="mt-2 grid gap-x-6 divide-y divide-line sm:grid-cols-2 sm:divide-y-0">
            {v.integrations.map((i) => (
              <li key={i.key} className="flex items-start justify-between gap-3 py-3 sm:border-b sm:border-line">
                <div className="min-w-0">
                  <p className="font-semibold text-ink">{t(`in.${i.key}`)}</p>
                  <p className="text-sm text-muted">{t(`in.${i.key}.hint`)}</p>
                </div>
                <Badge tone={TONE[i.state]}>{stateLabel(i.key, i.state)}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      </section>
      <Privacy t={t} />
    </>
  );
}
