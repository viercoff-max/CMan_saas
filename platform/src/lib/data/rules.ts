// Backend-neutral data rules shared by every DataStore implementation (SQLite and Supabase must behave the same).
// They mirror the CHECK constraints of supabase/migrations so both backends reject the same input.
// NOTE: relative, type-only imports here (the CLI scripts load src/lib with Node's type stripping).
import type { AgentSettings } from "../types";
import { DataValidationError } from "./errors";
import type { BrandSettings } from "./types";

// ---------- brand (white-label) ----------
export const BRAND_DEFAULTS = { primaryColor: "#0F766E", accentColor: "#14181F", menuBgColor: "#F6F7F9", headingFont: "system" } as const;
const HEX = /^#[0-9A-Fa-f]{6}$/;
const FONT = /^[A-Za-z0-9 ]{1,60}$/;

/** Same rules as the CHECK constraints of public.brand_settings. */
export function validateBrand(b: Omit<BrandSettings, "tenantId" | "updatedAt">): void {
  if (typeof b.displayName !== "string" || b.displayName.length > 120) throw new DataValidationError("displayName");
  if (b.logoPath !== null && (typeof b.logoPath !== "string" || b.logoPath.length > 300)) throw new DataValidationError("logoPath");
  for (const k of ["primaryColor", "accentColor", "menuBgColor"] as const) if (!HEX.test(String(b[k]))) throw new DataValidationError(k);
  if (!FONT.test(String(b.headingFont))) throw new DataValidationError("headingFont");
}

// ---------- agent settings ----------
export const clampTone = (n: unknown) => Math.min(5, Math.max(1, Math.round(Number(n)))) as AgentSettings["toneLevel"];
export const clampCrossSell = (n: unknown) => Math.min(3, Math.max(0, Math.round(Number(n)))) as AgentSettings["crossSellLevel"];

// ---------- AI usage ----------
/** First day of the month of `at` (UTC), as "YYYY-MM-01" (Supabase ai_usage.period is a date). */
export const usagePeriod = (at: Date = new Date()) => `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}-01`;
export const nonNeg = (n: unknown) => Math.max(0, Math.floor(Number(n) || 0));
