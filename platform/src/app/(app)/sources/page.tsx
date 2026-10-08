import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { getSession } from "@/lib/auth";
import { getLocale, makeT } from "@/lib/i18n";
import { dict } from "@/lib/context/dict";
import { listSources } from "@/lib/store";
import { listSectionLinks, sectionFileSourceIds } from "@/lib/context/section-repo";
import { SourcesManager } from "./SourcesManager";

export const dynamic = "force-dynamic";

export default async function Page() {
  const s = await getSession();
  if (!s) redirect("/login");
  const t = makeT(dict, await getLocale());
  // Files uploaded inside a Context section ("Usar un archivo") belong to that section and are managed there.
  const sectionFiles = sectionFileSourceIds(s.tenantId);
  const links = listSectionLinks(s.tenantId);
  const sources = listSources(s.tenantId).filter((x) => !sectionFiles.has(x.id)).map((x) => ({
    id: x.id, kind: x.kind, title: x.title, url: x.url, status: x.status, error: x.error, lastSyncedAt: x.lastSyncedAt,
    sections: links.filter((l) => l.sourceId === x.id).map((l) => t(`sec.${l.sectionKey}.title`)),
  }));
  return (
    <>
      <PageHeader title={t("src.title")} subtitle={t("src.subtitle")} />
      <SourcesManager sources={sources} />
    </>
  );
}
