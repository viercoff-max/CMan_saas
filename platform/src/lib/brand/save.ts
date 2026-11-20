// Saving the brand (the /brand screen and onboarding step 2). SERVER ONLY.
// Rules: admin/owner of the ACTIVE tenant only; the tenant is ALWAYS session.tenantId (a tenant id in the form is
// ignored); logoPath is never taken from the client (only from a fresh uploadLogo or a removal); the old logo is
// deleted only after the new settings were saved; the audit row lists the changed field NAMES only.
import { z } from "zod";
import { AUDIT, auditEvent } from "../audit-events";
import { hasRole } from "../auth/roles";
import type { Session } from "../auth/session";
import { DataValidationError, getData } from "../data";
import type { BrandPatch, BrandSettings } from "../data/types";
import { LOGO_MAX_BYTES, logoUrl, removeLogo, uploadLogo } from "../storage/logo";
import { HEADING_FONT_KEYS } from "./theme";

const Hex = z.string().trim().regex(/^#[0-9A-Fa-f]{6}$/).transform((s) => s.toUpperCase());
export const BrandInputSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional(),
  primaryColor: Hex.optional(),
  accentColor: Hex.optional(),
  menuBgColor: Hex.optional(),
  headingFont: z.enum(HEADING_FONT_KEYS as [string, ...string[]]).optional(),
  removeLogo: z.boolean().optional(),
});
export type BrandInput = z.infer<typeof BrandInputSchema>;
export type BrandField = "displayName" | "primaryColor" | "accentColor" | "menuBgColor" | "headingFont";

export type LogoError = "empty" | "too_big" | "bad_type";
export type SaveBrandResult =
  | { ok: true; brand: BrandSettings; logoUrl: string | null; changed: string[] }
  | { ok: false; error: "forbidden" | "invalid" | "failed" | LogoError; field?: BrandField };

export interface LogoUpload { bytes: Uint8Array; type: string }

const FIELDS: BrandField[] = ["displayName", "primaryColor", "accentColor", "menuBgColor", "headingFont"];

/** FormData -> validated input. Absent / empty fields are "not changed" (onboarding sends only the primary colour). */
export function parseBrandForm(form: FormData): { ok: true; input: BrandInput } | { ok: false; field: BrandField } {
  const raw: Record<string, unknown> = {};
  for (const k of FIELDS) {
    const v = form.get(k);
    if (typeof v === "string" && (k === "displayName" || v.trim() !== "")) raw[k] = v;
  }
  if (form.get("removeLogo") === "1") raw.removeLogo = true;
  const p = BrandInputSchema.safeParse(raw);
  if (p.success) return { ok: true, input: p.data };
  const field = p.error.issues[0]?.path[0];
  return { ok: false, field: (FIELDS as string[]).includes(String(field)) ? (field as BrandField) : "displayName" };
}

export async function saveBrand(session: Session, input: BrandInput, logo: LogoUpload | null = null): Promise<SaveBrandResult> {
  if (!hasRole(session.role, "admin")) return { ok: false, error: "forbidden" };
  const tenantId = session.tenantId;
  const parsed = BrandInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "invalid" };
  const inp = parsed.data;
  if (logo && logo.bytes.byteLength > LOGO_MAX_BYTES) return { ok: false, error: "too_big" };

  const data = getData();
  const current = await data.brand.get(tenantId);
  const patch: BrandPatch = {};
  for (const k of FIELDS) { const v = inp[k]; if (v !== undefined && v !== current[k]) patch[k] = v; }

  let uploaded: string | null = null;
  if (logo) {
    const r = await uploadLogo(tenantId, logo.bytes, logo.type);
    if (!r.ok) return { ok: false, error: r.error };
    uploaded = r.path;
    patch.logoPath = r.path;
  } else if (inp.removeLogo && current.logoPath) {
    patch.logoPath = null;
  }

  const changed = Object.keys(patch);
  if (!changed.length) return { ok: true, brand: current, logoUrl: logoUrl(tenantId, current.logoPath), changed };

  let saved: BrandSettings;
  try { saved = await data.brand.save(tenantId, patch); }
  catch (e) {
    if (uploaded) await removeLogo(tenantId, uploaded).catch(() => undefined); // no orphan logo without its row
    if (e instanceof DataValidationError) return { ok: false, error: "invalid" };
    console.error("[brand] save failed:", e instanceof Error ? e.name : "error");
    return { ok: false, error: "failed" };
  }
  // Only after the new path is stored: the previous logo is no longer referenced.
  if ("logoPath" in patch && current.logoPath && current.logoPath !== saved.logoPath) {
    await removeLogo(tenantId, current.logoPath).catch(() => undefined);
  }
  await auditEvent(tenantId, session.userId, AUDIT.brandSaved, changed.join(","));
  return { ok: true, brand: saved, logoUrl: logoUrl(tenantId, saved.logoPath), changed };
}
