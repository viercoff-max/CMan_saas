import { PageHeader } from "@/components/ui";
import { requireAdminPage } from "@/components/guards";
import { getLocale, makeT } from "@/lib/i18n";
import { dict } from "@/lib/context/dict";
import { getData } from "@/lib/data";
import { CONTEXT_SECTION_KEYS, type ContextSectionKey } from "@/lib/types";
import { getEffectiveSectionContent, PREVIEW_CHARS, sectionFileSourceIds, type SectionMode } from "@/lib/context/section-repo";
import { getFileStore, keyFromStored } from "@/lib/storage";
import { ContextForm, type SectionFileInfo, type SourceOption } from "./ContextForm";
import { FullFileCard, type FullFileInfo } from "./FullFileCard";

export const dynamic = "force-dynamic";

async function fileSize(tenantId: string, stored: string | null): Promise<number | null> {
  const key = keyFromStored(tenantId, stored);
  if (!key) return null;
  try { return (await getFileStore().stat(tenantId, key))?.size ?? null; } catch { return null; }
}

export default async function Page() {
  const s = await requireAdminPage(); // agents are redirected to /inbox before anything renders
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

  // "Opción rápida": general uploaded files (not a section file, not linked to a section) = the whole-business file(s).
  const linkedAnywhere = new Set(Object.values(links).flat());
  const fullFiles: FullFileInfo[] = sources.filter((x) => x.kind === "file" && !linkedAnywhere.has(x.id))
    .map((x) => ({ id: x.id, name: x.title, status: x.status, error: x.error }));
  const hasFullFile = fullFiles.some((f) => f.status === "indexed");

  return (
    <>
      <PageHeader title={t("ctx.title")} subtitle={t("ctx.subtitle")} />
      <FullFileCard files={fullFiles} />
      <h2 className="mb-3 mt-6 text-sm font-semibold uppercase tracking-wide text-muted">{hasFullFile ? t("ctx.sectionsTitleFull") : t("ctx.sectionsTitle")}</h2>
      <ContextForm initial={initial} modes={modes} files={files} links={links} sources={sources} hasFullFile={hasFullFile} />
    </>
  );
}
