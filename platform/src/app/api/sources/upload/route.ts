import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth";
import { audit, createSource } from "@/lib/store";
import { indexSource } from "@/lib/context/index-source";
import { readValidatedUpload, storeUpload } from "@/lib/context/upload";
import { checkSameOrigin } from "@/lib/security/origin";
import { limitOr429 } from "@/lib/security/rate-limit";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const bad = checkSameOrigin(req); if (bad) return bad;
  let session;
  try { session = await requireSession(); } catch (e) { if (e instanceof Response) return e; throw e; }
  const limited = limitOr429(`upload:${session.tenantId}`, 30, 60 * 60_000); if (limited) return limited;

  const up = await readValidatedUpload(req);
  if (up instanceof Response) return up;
  const rel = await storeUpload(session.tenantId, up.original, up.bytes);
  if (!rel) return NextResponse.json({ error: "bad_type" }, { status: 400 });

  const src = createSource(session.tenantId, { kind: "file", title: up.original, filePath: rel });
  audit(session.tenantId, session.userId, "source.upload", src.id);
  const r = await indexSource(session.tenantId, src.id);
  return NextResponse.json({ ok: true, id: src.id, indexed: r.ok, chunks: r.chunks, error: r.error });
}
