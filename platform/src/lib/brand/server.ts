// Shell branding for the (app) layout. SERVER ONLY (reads the data layer and storage).
// Any failure falls back to the platform default theme: branding must never break the app.
import { getData } from "../data";
import type { BrandSettings } from "../data/types";
import { logoUrl } from "../storage/logo";
import { computeTheme, isPlatformDefault, PLATFORM_BRAND, themeStyle } from "./theme";

export interface ShellBrand {
  displayName: string;
  logoUrl: string | null;
  /** Inline style for the data-brand wrapper, or null for the platform default theme. */
  style: Record<string, string> | null;
}

export function shellBrandFrom(tenantId: string, b: BrandSettings | null, fallbackName: string): ShellBrand {
  if (!b) return { displayName: fallbackName, logoUrl: null, style: null };
  let url: string | null = null;
  try { url = logoUrl(tenantId, b.logoPath); } catch { url = null; }
  return {
    displayName: b.displayName.trim() || fallbackName,
    logoUrl: url,
    style: isPlatformDefault(b) ? null : themeStyle(computeTheme(b)),
  };
}

export async function loadShellBrand(tenantId: string, fallbackName: string): Promise<ShellBrand> {
  let b: BrandSettings | null = null;
  try { b = await getData().brand.get(tenantId); }
  catch (e) { console.error("[brand] settings not loaded:", e instanceof Error ? e.name : "error"); }
  return shellBrandFrom(tenantId, b, fallbackName);
}

export { PLATFORM_BRAND };
