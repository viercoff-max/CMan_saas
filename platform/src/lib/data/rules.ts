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

/** cap - used, never negative (usage.remaining in both backends). */
export const tokensRemaining = (cap: unknown, inputTokens: unknown, outputTokens: unknown): number =>
  Math.max(0, nonNeg(cap) - nonNeg(inputTokens) - nonNeg(outputTokens));

// ---------- legal hold (REVIEW-security-2 H1) ----------
/** Escalation reasons that put a conversation on a STICKY legal hold (product liability / PROFECO evidence). */
export const LEGAL_HOLD_REASONS = ["safety", "legal"] as const;
export const isLegalHoldReason = (r: unknown): boolean => typeof r === "string" && (LEGAL_HOLD_REASONS as readonly string[]).includes(r);

// ---------- tenants (platform-admin list) ----------
/** SQLite (on-prem, owner-operated) default. Supabase self-serve tenants default to SUPABASE_FREE_TOKEN_CAP. */
export const TENANT_DEFAULTS = { plan: "free", status: "active", aiMonthlyTokenCap: 2_000_000 } as const;
/** public.tenants.ai_monthly_token_cap default for new self-serve tenants (migration 20261120013724, REVIEW-security-2 M3). */
export const SUPABASE_FREE_TOKEN_CAP = 300_000;
/** tenants.listAll paging: limit 1..200 (default 50), offset >= 0, search trimmed to 100 chars ("" = no filter). */
export function tenantListArgs(q: { limit?: number; offset?: number; search?: string } = {}): { limit: number; offset: number; search: string } {
  const limit = Math.min(200, Math.max(1, Math.floor(Number(q.limit ?? 50)) || 50));
  const offset = Math.max(0, Math.floor(Number(q.offset ?? 0)) || 0);
  const search = String(q.search ?? "").trim().slice(0, 100);
  return { limit, offset, search };
}

// ---------- customers (same limits as the CHECK constraints of public.customers) ----------
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Trims and validates a customer patch; throws DataValidationError(field). Tags: trimmed, unique, max 20 x 40 chars. */
export function normalizeCustomerPatch(p: {
  name?: unknown; email?: unknown; phone?: unknown; tags?: unknown; notes?: unknown;
}): { name?: string; email?: string | null; phone?: string | null; tags?: string[]; notes?: string } {
  const out: { name?: string; email?: string | null; phone?: string | null; tags?: string[]; notes?: string } = {};
  if (p.name !== undefined) {
    const v = String(p.name ?? "").trim();
    if (v.length > 200) throw new DataValidationError("name");
    out.name = v;
  }
  if (p.email !== undefined) {
    const v = String(p.email ?? "").trim().toLowerCase();
    if (v && (v.length > 320 || !EMAIL_SHAPE.test(v))) throw new DataValidationError("email");
    out.email = v || null;
  }
  if (p.phone !== undefined) {
    const v = String(p.phone ?? "").trim();
    if (v && (v.length > 40 || !/^[+0-9 ()\-.]{4,40}$/.test(v))) throw new DataValidationError("phone");
    out.phone = v || null;
  }
  if (p.tags !== undefined) {
    if (!Array.isArray(p.tags)) throw new DataValidationError("tags");
    const tags = [...new Set(p.tags.map((t) => String(t ?? "").trim()).filter(Boolean))];
    if (tags.length > 20 || tags.some((t) => t.length > 40)) throw new DataValidationError("tags");
    out.tags = tags;
  }
  if (p.notes !== undefined) {
    const v = String(p.notes ?? "");
    if (v.length > 4000) throw new DataValidationError("notes");
    out.notes = v;
  }
  return out;
}
