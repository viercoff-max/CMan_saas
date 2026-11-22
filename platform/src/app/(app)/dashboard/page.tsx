import { redirect } from "next/navigation";
import { getSession, hasRole } from "@/lib/auth";
import { authBackend } from "@/lib/auth/backend";
import { getLocale, makeT } from "@/lib/i18n";
import { shellDict } from "@/lib/shell-dict";
import { getData } from "@/lib/data";
import { getEffectiveSectionContent, isSectionFilled } from "@/lib/context/section-repo";
import { CONTEXT_SECTION_KEYS } from "@/lib/types";
import { Badge, Card, LinkButton, PageHeader } from "@/components/ui";
import { loadAiUsage } from "../billing/data";
import { loadInboxCounts } from "../inbox/counts";
import { buildSteps, type StepState } from "./steps";
import Link from "next/link";
import { METRIC_KEYS, PERIODS, isPeriod, resolveCards, ADMIN_ONLY_CARDS } from "@/lib/metrics/dashboard";
import { loadMetrics } from "@/lib/metrics/load";
import { metricsDict } from "./metrics-dict";
import { MetricCards, type AiSummary } from "./Metrics";
import { Customize } from "./Customize";

// Approximate Claude Haiku price used for the dashboard estimate (USD per million tokens). Display only.
const PRICE_IN_PER_M = 0.10;
const PRICE_OUT_PER_M = 0.50;

const CHANNELS = ["telegram", "whatsapp", "instagram", "messenger"] as const;

/** Admin-only checks (context, sources, channels, add-ons, team, brand). Agents never trigger these reads. */
async function adminState(tenantId: string): Promise<Omit<StepState, "tested">> {
  const data = getData();
  const [effective, sources, channels, addon, toneSaved, members, brand] = await Promise.all([
    Promise.all(CONTEXT_SECTION_KEYS.map((k) => getEffectiveSectionContent(tenantId, k))),
    data.sources.list(tenantId),
    Promise.all(CHANNELS.map((c) => data.channels.get(tenantId, c))),
    data.addons.get(tenantId, "shopify"),
    data.settings.isToneSaved(tenantId),
    data.members.list(tenantId),
    data.brand.get(tenantId),
  ]);
  const shop = addon.status === "connected";
  return {
    // A section counts whether it uses typed text or an uploaded file (or linked Data sources).
    context: effective.some((e) => isSectionFilled(e, 21)),
    tone: toneSaved,
    sources: sources.some((x) => x.status === "indexed"),
    channels: channels.some((a) => a.status === "connected"),
    team: members.length > 1,
    brand: brand.updatedAt !== null,
    shop, shopDemo: shop && addon.publicInfo.mock === true,
    canInvite: authBackend() === "supabase",
  };
}
const NO_ADMIN: Omit<StepState, "tested"> = {
  context: false, tone: false, sources: false, channels: false, team: false, brand: false, shop: false, shopDemo: false, canInvite: false,
};

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ period?: string }> }) {
  const s = await getSession();
  if (!s) redirect("/login");
  const locale = await getLocale();
  const t = makeT(shellDict, locale);
  const tm = makeT(metricsDict, locale);
  const sp = await searchParams;
  const period = isPeriod(sp.period) ? sp.period : "7d";
  const isAdmin = hasRole(s.role, "admin");
  const [{ counts }, usage, admin, metrics, saved, tokens] = await Promise.all([
    loadInboxCounts(s.tenantId), // same loader as the inbox banner and the sidebar badge (P2-1)
    loadAiUsage(s.tenantId),
    isAdmin ? adminState(s.tenantId) : Promise.resolve(NO_ADMIN),
    loadMetrics(s.tenantId, period),
    getData().dashboardPrefs.get(s.tenantId, s.userId),
    isAdmin ? getData().usage.get(s.tenantId) : Promise.resolve(null),
  ]);
  const cards = resolveCards(saved, isAdmin);
  const available = METRIC_KEYS.filter((k) => isAdmin || !ADMIN_ONLY_CARDS.has(k));
  const costUsd = tokens ? (tokens.inputTokens * PRICE_IN_PER_M + tokens.outputTokens * PRICE_OUT_PER_M) / 1_000_000 : 0;
  const aiSummary: AiSummary | null = isAdmin ? {
    used: usage.ai.used, cap: usage.ai.cap, percent: usage.ai.percent, noCap: usage.ai.noCap, costUsd,
    perConversationUsd: metrics.conversations ? costUsd / Math.max(1, metrics.conversations) : null,
  } : null;
  const tested = counts.bot + counts.human + counts.resolved + counts.needs_human > 0;
  const { steps, nextIdx } = buildSteps(s.role, { ...admin, tested });
  const doneCount = steps.filter((x) => x.done).length;
  const firstName = s.name.trim().split(/\s+/)[0] || "";

  return (
    <>
      <PageHeader title={firstName ? t("dash.hello", { name: firstName }) : t("dash.title")} subtitle={isAdmin ? t("dash.subtitle") : t("dash.agentSubtitle")} />
      {isAdmin && nextIdx === -1 && <p className="mb-4 rounded-xl bg-green-100 px-4 py-3 text-sm text-green-900" role="status">{t("dash.allDone")}</p>}
      {admin.shopDemo && <p className="mb-4 rounded-xl bg-amber-100 px-4 py-3 text-sm text-amber-900" role="status">{t("dash.demo")}</p>}
      <section aria-labelledby="dash-metrics" className="mb-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <h2 id="dash-metrics" className="text-base font-semibold text-ink">{tm("m.title")}</h2>
          <nav aria-label={tm("m.period")} className="flex gap-1 rounded-xl border border-line bg-surface p-1">
            {PERIODS.map((p) => (
              <Link key={p} href={`/dashboard?period=${p}`} aria-current={p === period ? "page" : undefined}
                className={`inline-flex min-h-10 items-center rounded-lg px-3 text-sm font-medium ${p === period ? "bg-brand text-on-brand" : "text-muted hover:text-ink"}`}>{tm(`m.p.${p}`)}</Link>
            ))}
          </nav>
        </div>
        <div className="mb-3"><Customize all={[...available]} selected={cards} /></div>
        {metrics.capped && <p className="mb-3 text-xs text-muted">{tm("m.capped")}</p>}
        {cards.length === 0 ? <Card><p className="text-sm text-muted">{tm("m.empty")}</p></Card>
          : <MetricCards cards={cards} m={metrics} ai={aiSummary} t={tm} locale={locale} timeZone={metrics.timeZone} />}
      </section>
      {steps.length > 0 && (
        <section aria-labelledby="dash-checklist">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 id="dash-checklist" className="text-base font-semibold text-ink">{t("dash.checklist")}</h2>
            <span className="text-sm text-muted">{t("dash.progress", { done: doneCount, total: steps.length })}</span>
          </div>
          <div className="space-y-3">
            {steps.map((st, i) => (
              <Card key={st.id} className={`flex flex-wrap items-center justify-between gap-3 sm:flex-nowrap sm:gap-4 ${i === nextIdx ? "bg-brand-soft" : ""}`}>
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-canvas text-sm font-semibold text-muted" aria-label={t("dash.step", { n: i + 1 })}>{i + 1}</span>
                  <span className="font-medium">{t(st.label)}</span>
                  {st.done ? <Badge tone="good">{t("dash.done")}</Badge> : st.optional ? <Badge>{t("dash.optional")}</Badge> : i === nextIdx ? <Badge tone="info">{t("dash.next")}</Badge> : null}
                </div>
                <LinkButton href={st.href} variant={i === nextIdx ? "primary" : "secondary"}>{st.done ? t("dash.review") : t("dash.start")}</LinkButton>
              </Card>
            ))}
          </div>
        </section>
      )}
      {!isAdmin && (
        <div className="mt-6"><LinkButton href="/inbox" variant={nextIdx === -1 ? "primary" : "secondary"}>{t("dash.openInbox")}</LinkButton></div>
      )}
    </>
  );
}
