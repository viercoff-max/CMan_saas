// Platform-owner area (/platform). SERVER ONLY.
// Order is the security contract: (1) signed-in user -> (2) platformAdmins.isPlatformAdmin(userId) -> only then
// (3) any CROSS-TENANT read or write (lib/platform/console.ts). Anyone else (anonymous, tenant owners/admins/agents)
// gets notFound(), so the screen does not reveal that it exists. No impersonation.
import { cache } from "react";
import { notFound } from "next/navigation";
import { getAuthState } from "../auth";
import { getData } from "../data";
import { AUDIT_GLOBAL_TENANT, type TenantOverview } from "../data/types";
import { auditEvent } from "../audit-events";
import { hashKey, hit } from "../security/rate-limit";

export const PLATFORM_VIEW_ACTION = "platform.view";
const HOUR_MS = 60 * 60 * 1000;

export interface PlatformAdmin { userId: string; name: string; email: string }

/** null = not a platform admin (or not signed in, or the check failed: fail closed). Never throws. */
export async function checkPlatformAdmin(): Promise<PlatformAdmin | null> {
  try {
    const st = await getAuthState();
    const user = st.status === "ok"
      ? { id: st.session.userId, name: st.session.name, email: st.session.email }
      : st.status === "no_tenant" ? st.user : null;
    if (!user?.id) return null;
    if ((await getData().platformAdmins.isPlatformAdmin(user.id)) !== true) return null;
    return { userId: user.id, name: user.name, email: user.email };
  } catch {
    return null;
  }
}

/** For the (platform) layout and page: the admin, or a 404. Memoised per request (layout + page share one check). */
export const requirePlatformAdmin = cache(async (): Promise<PlatformAdmin> => {
  const admin = await checkPlatformAdmin();
  if (!admin) notFound();
  return admin;
});

/**
 * Global audit row "platform.view" at most once per admin per hour (fixed one-hour window in the shared rate-limit
 * table, so it also holds across server instances). Never throws, never blocks the page.
 */
export async function recordPlatformView(userId: string, now = Date.now()): Promise<boolean> {
  try {
    const r = await hit(hashKey("platform-view", userId), 1, HOUR_MS, now);
    if (!r.ok) return false;
    await auditEvent(AUDIT_GLOBAL_TENANT, userId, PLATFORM_VIEW_ACTION, "");
    return true;
  } catch {
    return false;
  }
}

export interface PlatformQuery { q: string; page: number }

/** Search params -> safe query (search max 100 chars, page 1..10000). */
export function parsePlatformQuery(sp: Record<string, string | string[] | undefined>): PlatformQuery {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  const q = one(sp.q).replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 100);
  const n = Number.parseInt(one(sp.page), 10);
  const page = Number.isFinite(n) && n >= 1 ? Math.min(n, 10_000) : 1;
  return { q, page };
}

// ---------- pure helpers for the table ----------

/** Share of the monthly AI cap used, 0..100 (rounded down; a cap of 0 with usage counts as full). */
export function aiPercent(t: Pick<TenantOverview, "aiTokensThisMonth" | "aiMonthlyTokenCap">): number {
  if (t.aiMonthlyTokenCap <= 0) return t.aiTokensThisMonth > 0 ? 100 : 0;
  return Math.max(0, Math.min(100, Math.floor((t.aiTokensThisMonth / t.aiMonthlyTokenCap) * 100)));
}

export type UsageLevel = "ok" | "high" | "full";
export function aiLevel(pct: number): UsageLevel {
  return pct >= 100 ? "full" : pct >= 80 ? "high" : "ok";
}

/** Needs a look from the platform owner: not active, or the AI cap is used up. */
export function needsAttention(t: TenantOverview): boolean {
  return t.status !== "active" || aiPercent(t) >= 100;
}

/** 1234 -> "1.2k", 2_500_000 -> "2.5M" (compact, locale-independent digits). */
export function compactNumber(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1).replace(/\.0$/, "")}M`;
  if (abs >= 1_000) return `${(n / 1_000).toFixed(abs >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return String(n);
}
