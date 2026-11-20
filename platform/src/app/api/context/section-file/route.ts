// "Usar un archivo" on the Context screen: uploads the file of ONE section (replaces the previous one).
// Same checks as /api/sources/upload (same-origin, session, rate limit, type/size/magic bytes); the file is stored
// as a normal `sources` row so extraction and indexing are shared, and the section switches to file mode.
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth";
import { getData } from "@/lib/data";
import { indexSource } from "@/lib/context/index-source";
import { deleteSourceAndLinks } from "@/lib/context/section-index";
import { getSectionMeta, isSectionKey, PREVIEW_CHARS } from "@/lib/context/section-repo";
import { discardUpload, readValidatedUpload, storeUpload } from "@/lib/context/upload";
import { checkSameOrigin } from "@/lib/security/origin";
import { limitOr429 } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const bad = checkSameOrigin(req); if (bad) return bad;
  let session;
  try { session = await requireRole("admin"); } catch (e) { if (e instanceof Response) return e; throw e; }
  // Shares the upload budget with the Sources screen.
  const limited = await limitOr429(`upload:${session.tenantId}`, 30, 60 * 60_000); if (limited) return limited;

  const up = await readValidatedUpload(req);
  if (up instanceof Response) return up;
  const key = up.form.get("section");
  if (!isSectionKey(key)) return NextResponse.json({ error: "bad_section" }, { status: 400 });

  const rel = await storeUpload(session.tenantId, up.original, up.bytes);
  if (!rel) return NextResponse.json({ error: "upload_failed" }, { status: 500 });

  const data = getData();
  const previous = (await getSectionMeta(session.tenantId, key)).fileSourceId;
  let src;
  try { src = await data.sources.create(session.tenantId, { kind: "file", title: up.original, filePath: rel }); }
  catch (e) { await discardUpload(session.tenantId, rel); throw e; } // no orphan object without its row
  // Attach first so indexing chunks it as part of the section (never as a general source).
  await data.sections.setFile(session.tenantId, key, src.id);
  await data.sections.setMode(session.tenantId, key, "file");
  if (previous && previous !== src.id) await deleteSourceAndLinks(session.tenantId, previous);
  const r = await indexSource(session.tenantId, src.id);
  await data.audit.log(session.tenantId, session.userId, "context.section_file", `${key} ${src.id}`);

  const text = (await data.sources.getText(session.tenantId, src.id))?.text ?? "";
  return NextResponse.json({
    ok: true, id: src.id, name: up.original, size: up.size, indexed: r.ok, error: r.error,
    preview: r.ok ? text.slice(0, PREVIEW_CHARS) : "",
  });
}
