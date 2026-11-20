// POST /brand/save (multipart): the "Guardar marca" button of /brand and onboarding step 2 "Tu marca".
// A route handler (not a Server Action) because a logo may be up to 2 MB and Server Actions cap bodies at 1 MB.
// Same-origin check (route handlers get no built-in CSRF check), admin of the ACTIVE tenant, rate limit, then
// lib/brand/save.ts does the rest (tenant = session.tenantId, never the form).
import { NextResponse } from "next/server";
import { getSession, hasRole } from "@/lib/auth";
import { parseBrandForm, saveBrand, type LogoUpload } from "@/lib/brand/save";
import { checkSameOrigin } from "@/lib/security/origin";
import { limitOr429 } from "@/lib/security/rate-limit";
import { LOGO_MAX_BYTES } from "@/lib/storage/logo";

export const runtime = "nodejs";

/** Logo + a few short text fields + multipart framing. */
const MAX_BODY = LOGO_MAX_BYTES + 64 * 1024;

export async function POST(req: Request) {
  const bad = checkSameOrigin(req); if (bad) return bad;
  const session = await getSession();
  if (!session) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  if (!hasRole(session.role, "admin")) return NextResponse.json({ ok: false, error: "forbidden" }, { status: 403 });
  const limited = await limitOr429(`brand:${session.tenantId}`, 30, 15 * 60_000); if (limited) return limited;

  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BODY) return NextResponse.json({ ok: false, error: "too_big" }, { status: 413 });
  let form: FormData;
  try { form = await req.formData(); } catch { return NextResponse.json({ ok: false, error: "invalid" }, { status: 400 }); }

  const parsed = parseBrandForm(form);
  if (!parsed.ok) return NextResponse.json({ ok: false, error: "invalid", field: parsed.field }, { status: 400 });

  let logo: LogoUpload | null = null;
  const file = form.get("logo");
  if (file instanceof File && (file.size > 0 || file.name)) {
    if (file.size > LOGO_MAX_BYTES) return NextResponse.json({ ok: false, error: "too_big" }, { status: 413 });
    logo = { bytes: new Uint8Array(await file.arrayBuffer()), type: file.type };
  }

  const r = await saveBrand(session, parsed.input, logo);
  if (!r.ok) {
    const status = r.error === "forbidden" ? 403 : r.error === "failed" ? 500 : r.error === "too_big" ? 413 : 400;
    return NextResponse.json(r, { status });
  }
  return NextResponse.json({ ok: true, changed: r.changed, logoUrl: r.logoUrl, brand: {
    displayName: r.brand.displayName, primaryColor: r.brand.primaryColor, accentColor: r.brand.accentColor,
    menuBgColor: r.brand.menuBgColor, headingFont: r.brand.headingFont,
  } });
}
