import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getLocale, makeT } from "@/lib/i18n";
import { shellDict } from "@/lib/shell-dict";
import { countConversationsByStatus, getAddon, getChannelAccount, listSources } from "@/lib/store";
import { getEffectiveSectionContent, isSectionFilled } from "@/lib/context/section-repo";
import { CONTEXT_SECTION_KEYS } from "@/lib/types";
import { Badge, Card, LinkButton, PageHeader } from "@/components/ui";
import { isToneSaved } from "@/lib/context/tone-saved";

export default async function Dashboard() {
  const s = await getSession();
  if (!s) redirect("/login");
  const t = makeT(shellDict, await getLocale());
  // A section counts whether it uses typed text or an uploaded file (or linked Data sources).
  const ctxDone = CONTEXT_SECTION_KEYS.some((k) => isSectionFilled(getEffectiveSectionContent(s.tenantId, k), 21));
  const srcDone = listSources(s.tenantId).some((x) => x.status === "indexed");
  const chDone = (["whatsapp", "instagram", "messenger"] as const).some((c) => getChannelAccount(s.tenantId, c).status === "connected");
  const shopDone = getAddon(s.tenantId, "shopify").status === "connected";
  const counts = countConversationsByStatus(s.tenantId);

  const addon = getAddon(s.tenantId, "shopify");
  const demo = shopDone && addon.publicInfo.mock === true;
  const tested = counts.bot + counts.human + counts.resolved + counts.needs_human > 0;
  // Testing the simulator comes before connecting real channels.
  const steps = [
    { href: "/context", label: t("dash.step.context"), done: ctxDone, optional: false },
    { href: "/tone", label: t("dash.step.tone"), done: isToneSaved(s.tenantId), optional: false },
    { href: "/sources", label: t("dash.step.sources"), done: srcDone, optional: false },
    { href: "/inbox?simulator=1", label: t("dash.step.test"), done: tested, optional: false },
    { href: "/channels", label: t("dash.step.channels"), done: chDone, optional: false },
    { href: "/addons", label: t("dash.step.addons"), done: shopDone && !demo, optional: true },
  ];
  // Only the first unfinished required step is the primary button; everything else is secondary.
  const nextIdx = steps.findIndex((x) => !x.done && !x.optional);
  return (
    <>
      <PageHeader title={t("dash.title")} subtitle={t("dash.subtitle")} />
      {nextIdx === -1 && <p className="mb-4 rounded-xl bg-green-100 px-4 py-3 text-sm text-green-900" role="status">{t("dash.allDone")}</p>}
      {demo && <p className="mb-4 rounded-xl bg-amber-100 px-4 py-3 text-sm text-amber-900" role="status">{t("dash.demo")}</p>}
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        {[["dash.stats.human", counts.needs_human + counts.human], ["dash.stats.bot", counts.bot], ["dash.stats.resolved", counts.resolved]].map(([k, v]) => (
          <Card key={k as string}><div className="text-3xl font-semibold">{v}</div><div className="text-sm text-muted">{t(k as string)}</div></Card>
        ))}
      </div>
      <div className="space-y-3">
        {steps.map((st, i) => (
          <Card key={st.href} className="flex flex-wrap items-center justify-between gap-3 sm:flex-nowrap sm:gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-canvas text-sm font-semibold text-muted" aria-label={t("dash.step", { n: i + 1 })}>{i + 1}</span>
              <span className="font-medium">{st.label}</span>
              {st.done ? <Badge tone="good">{t("dash.done")}</Badge> : st.optional ? <Badge>{t("dash.optional")}</Badge> : i === nextIdx ? <Badge tone="info">{t("dash.next")}</Badge> : null}
            </div>
            <LinkButton href={st.href} variant={i === nextIdx ? "primary" : "secondary"}>{st.done ? t("dash.review") : t("dash.start")}</LinkButton>
          </Card>
        ))}
      </div>
    </>
  );
}
