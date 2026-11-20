import { redirect } from "next/navigation";
import { getSession, hasRole } from "@/lib/auth";
import { authBackend } from "@/lib/auth/backend";
import { getLocale, makeT } from "@/lib/i18n";
import { shellDict } from "@/lib/shell-dict";
import { getData } from "@/lib/data";
import { getEffectiveSectionContent, isSectionFilled } from "@/lib/context/section-repo";
import { CONTEXT_SECTION_KEYS } from "@/lib/types";
import { Badge, Card, LinkButton, Meter, PageHeader } from "@/components/ui";
import { loadAiUsage } from "../billing/data";
import { billingDict } from "../billing/dict";
import { fmtDate } from "../billing/usage";
import { buildSteps, type StepState } from "./steps";

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

export default async function Dashboard() {
  const s = await getSession();
  if (!s) redirect("/login");
  const locale = await getLocale();
  const t = makeT(shellDict, locale);
  const tb = makeT(billingDict, locale);
  const isAdmin = hasRole(s.role, "admin");
  const [counts, usage, admin] = await Promise.all([
    getData().conversations.countByStatus(s.tenantId),
    loadAiUsage(s.tenantId),
    isAdmin ? adminState(s.tenantId) : Promise.resolve(NO_ADMIN),
  ]);
  const tested = counts.bot + counts.human + counts.resolved + counts.needs_human > 0;
  const { steps, nextIdx } = buildSteps(s.role, { ...admin, tested });
  const doneCount = steps.filter((x) => x.done).length;
  const firstName = s.name.trim().split(/\s+/)[0] || "";
  const ai = usage.ai;

  return (
    <>
      <PageHeader title={firstName ? t("dash.hello", { name: firstName }) : t("dash.title")} subtitle={isAdmin ? t("dash.subtitle") : t("dash.agentSubtitle")} />
      {isAdmin && nextIdx === -1 && <p className="mb-4 rounded-xl bg-green-100 px-4 py-3 text-sm text-green-900" role="status">{t("dash.allDone")}</p>}
      {admin.shopDemo && <p className="mb-4 rounded-xl bg-amber-100 px-4 py-3 text-sm text-amber-900" role="status">{t("dash.demo")}</p>}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[["dash.stats.human", counts.needs_human + counts.human], ["dash.stats.bot", counts.bot], ["dash.stats.resolved", counts.resolved]].map(([k, v]) => (
          <Card key={k as string}><div className="text-3xl font-semibold">{v}</div><div className="text-sm text-muted">{t(k as string)}</div></Card>
        ))}
        <Card>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">{tb("kpi.ai")}</div>
          <div className="mt-1 text-3xl font-semibold">{ai.noCap ? "—" : `${ai.percent}%`}</div>
          <div className="my-2"><Meter percent={ai.percent} label={tb("kpi.ai")} valueText={ai.noCap ? tb("kpi.aiNone") : `${ai.percent}%`} tone={ai.overCap || ai.noCap ? "bad" : "brand"} /></div>
          <div className="text-sm text-muted">{ai.noCap ? tb("kpi.aiNone") : tb("kpi.aiHint", { date: fmtDate(usage.renewsAt, locale, { day: "numeric", month: "short" }) })}</div>
        </Card>
      </div>
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
