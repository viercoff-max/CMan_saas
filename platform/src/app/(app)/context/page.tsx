import fs from "node:fs/promises";
import { PageHeader } from "@/components/ui";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getLocale, makeT } from "@/lib/i18n";
import { dict } from "@/lib/context/dict";
import { getData } from "@/lib/data";
import { CONTEXT_SECTION_KEYS, type ContextSectionKey } from "@/lib/types";
import { getEffectiveSectionContent, PREVIEW_CHARS, sectionFileSourceIds, type SectionMode } from "@/lib/context/section-repo";
import { resolveUploadPath } from "@/lib/context/upload-path";
import { ContextForm, type SectionFileInfo, type SourceOption } from "./ContextForm";

export const dynamic = "force-dynamic";

async function fileSize(tenantId: string, stored: string | null): Promise<number | null> {
  const full = stored ? resolveUploadPath(tenantId, stored) : null;
  if (!full) return null;
  try { return (await fs.stat(full)).size; } catch { return null; }
}

export default async function Page() {
  const s = await getSession();
  if (!s) redirect("/login");
  const t = makeT(dict, await getLocale());
  const tenantId = s.tenantId;
  const data = getData();
  const initial = Object.fromEntries((await data.sections.list(tenantId)).map((c) => [c.key, c.content])) as Record<ContextSectionKey, string>;

  const modes = {} as Record<ContextSectionKey, SectionMode>;
  const files = {} as Record<ContextSectionKey, SectionFileInfo | null>;
  for (const k of CONTEXT_SECTION_KEYS) {
    const eff = await getEffectiveSectionContent(tenantId, k);
    modes[k] = eff.mode;
    const src = eff.file ? await data.sources.getText(tenantId, eff.file.id) : null;
    files[k] = src ? {
      id: src.id, name: src.title, size: await fileSize(tenantId, src.filePath), status: src.status, error: src.error,
      preview: src.status === "indexed" ? src.text.slice(0, PREVIEW_CHARS) : "",
    } : null;
  }
  const links = Object.fromEntries(CONTEXT_SECTION_KEYS.map((k) => [k, [] as string[]])) as Record<ContextSectionKey, string[]>;
  for (const l of await data.sections.listLinks(tenantId)) links[l.sectionKey].push(l.sourceId);
  const hidden = await sectionFileSourceIds(tenantId);
  const sources: SourceOption[] = (await data.sources.list(tenantId)).filter((x) => !hidden.has(x.id))
    .map((x) => ({ id: x.id, kind: x.kind, title: x.title, url: x.url, status: x.status, error: x.error }));

  return (
    <>
      <PageHeader title={t("ctx.title")} subtitle={t("ctx.subtitle")} />
      <ContextForm initial={initial} modes={modes} files={files} links={links} sources={sources} />
    </>
  );
}
