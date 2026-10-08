import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { getLocale, makeT } from "@/lib/i18n";
import { dict } from "@/lib/context/dict";
import { hoursAreSaved, parseBusinessHours, storableCustomText } from "@/lib/context/settings";
import { getAgentSettings } from "@/lib/store";
import { ToneForm } from "./ToneForm";

export const dynamic = "force-dynamic";

export default async function Page() {
  const s = await getSession();
  if (!s) redirect("/login");
  const t = makeT(dict, await getLocale());
  const a = getAgentSettings(s.tenantId);
  return (
    <>
      <PageHeader title={t("tone.title")} subtitle={t("tone.subtitle")} />
      <ToneForm
        initial={{
          agentName: a.agentName, toneLevel: a.toneLevel, languageDefault: a.languageDefault, greeting: storableCustomText(a.greeting, "greeting"),
          fallbackMessage: storableCustomText(a.fallbackMessage, "fallback"), handoffEmail: a.handoffEmail, crossSellLevel: a.crossSellLevel,
          hours: parseBusinessHours(a.businessHours),
        }}
        hoursSaved={hoursAreSaved(a.businessHours)}
      />
    </>
  );
}
