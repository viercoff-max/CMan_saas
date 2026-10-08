// "Usar un archivo" on the Context screen: uploads the file of ONE section (replaces the previous one).
// Same checks as /api/sources/upload (same-origin, session, rate limit, type/size/magic bytes); the file is stored
// as a normal `sources` row so extraction and indexing are shared, and the section switches to file mode.
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit, createSource } from "@/lib/store";
import { indexSource } from "@/lib/context/index-source";
import { deleteSourceAndLinks } from "@/lib/context/section-index";
import { getSectionMeta, getSourceText, isSectionKey, PREVIEW_CHARS, setSectionFile, setSectionMode } from "@/lib/context/section-repo";
import { readValidatedUpload, storeUpload } from "@/lib/context/upload";
import { checkSameOrigin } from "@/lib/security/origin";
import { limitOr429 } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const bad = checkSameOrigin(req); if (bad) return bad;
  let session;
  try { session = await requireSession(); } catch (e) { if (e instanceof Response) return e; throw e; }
  // Shares the upload budget with the Sources screen.
  const limited = limitOr429(`upload:${session.tenantId}`, 30, 60 * 60_000); if (limited) return limited;

  const up = await readValidatedUpload(req);
  if (up instanceof Response) return up;
  const key = up.form.get("section");
  if (!isSectionKey(key)) return NextResponse.json({ error: "bad_section" }, { status: 400 });

  const rel = await storeUpload(session.tenantId, up.original, up.bytes);
  if (!rel) return NextResponse.json({ error: "bad_type" }, { status: 400 });

  const previous = getSectionMeta(session.tenantId, key).fileSourceId;
  const src = createSource(session.tenantId, { kind: "file", title: up.original, filePath: rel });
  // Attach first so indexing chunks it as part of the section (never as a general source).
  setSectionFile(session.tenantId, key, src.id);
  setSectionMode(session.tenantId, key, "file");
  if (previous && previous !== src.id) await deleteSourceAndLinks(session.tenantId, previous);
  const r = await indexSource(session.tenantId, src.id);
  audit(session.tenantId, session.userId, "context.section_file", `${key} ${src.id}`);

  const text = getSourceText(session.tenantId, src.id)?.text ?? "";
  return NextResponse.json({
    ok: true, id: src.id, name: up.original, size: up.size, indexed: r.ok, error: r.error,
    preview: r.ok ? text.slice(0, PREVIEW_CHARS) : "",
  });
}
