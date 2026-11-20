import { requireAdminPage } from "@/components/guards";
import { PageHeader } from "@/components/ui";
import { getLocale, makeT } from "@/lib/i18n";
import { dict } from "@/lib/context/dict";
import { hoursAreSaved, parseBusinessHours, storableCustomText } from "@/lib/context/settings";
import { getData } from "@/lib/data";
import { ToneForm } from "./ToneForm";

export const dynamic = "force-dynamic";

export default async function Page() {
  const s = await requireAdminPage(); // agents are redirected to /inbox before anything renders
  const t = makeT(dict, await getLocale());
  const a = await getData().settings.get(s.tenantId);
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
