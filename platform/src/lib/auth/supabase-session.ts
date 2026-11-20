// Supabase mode: who is signed in, and which tenants they belong to. Reads go through the USER-session client, so
// RLS (members_select / tenants_select) limits them to the caller's own memberships.
import type { SupabaseClient } from "@supabase/supabase-js";
import { isRole } from "./roles";
import { toSession, type AuthState, type AuthUser, type TenantMembership } from "./session";

type Claims = { sub?: string; email?: string; user_metadata?: Record<string, unknown> };

export function displayName(email: string, meta?: Record<string, unknown>): string {
  const n = typeof meta?.name === "string" ? meta.name.trim() : typeof meta?.full_name === "string" ? meta.full_name.trim() : "";
  return (n || email.split("@")[0] || "").slice(0, 120);
}

/** Verified user (getClaims checks the JWT signature / asks Auth), or null. */
export async function supabaseUser(client: SupabaseClient): Promise<AuthUser | null> {
  const { data, error } = await client.auth.getClaims();
  const claims = (data?.claims ?? null) as Claims | null;
  if (error || !claims?.sub) return null;
  const email = (claims.email ?? "").toLowerCase();
  return { id: claims.sub, email, name: displayName(email, claims.user_metadata) };
}

type MemberRow = { tenant_id: string; role: string; tenants: { name?: string; status?: string } | { name?: string; status?: string }[] | null };

/**
 * ACTIVE memberships only (L1, REVIEW-security-2): tenants that are suspended or deleted give no app access.
 * `suspended` counts the user's memberships of suspended tenants (so the app can say why instead of onboarding).
 */
async function readMemberships(client: SupabaseClient, userId: string): Promise<{ active: TenantMembership[]; suspended: number }> {
  const { data, error } = await client
    .from("tenant_members")
    .select("tenant_id, role, created_at, tenants(name, status)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw new Error("membership_lookup_failed"); // fail closed, no details
  const active: TenantMembership[] = [];
  let suspended = 0;
  for (const r of (data ?? []) as MemberRow[]) {
    const t = Array.isArray(r.tenants) ? r.tenants[0] : r.tenants;
    if (!t || !isRole(r.role) || typeof r.tenant_id !== "string") continue;
    if (t.status === "suspended") { suspended++; continue; }
    if (t.status !== "active") continue; // deleted (or unknown): as if the membership did not exist
    active.push({ id: r.tenant_id, name: String(t.name ?? ""), role: r.role });
  }
  return { active, suspended };
}

export async function listMemberships(client: SupabaseClient, userId: string): Promise<TenantMembership[]> {
  return (await readMemberships(client, userId)).active;
}

/** Full resolution for one request: user -> memberships -> active tenant (cookie checked against memberships). */
export async function resolveSupabaseAuth(client: SupabaseClient, activeTenantCookie: string | null | undefined): Promise<AuthState> {
  const user = await supabaseUser(client);
  if (!user) return { status: "anonymous" };
  const m = await readMemberships(client, user.id);
  if (!m.active.length && m.suspended > 0) return { status: "no_tenant", user, suspended: true };
  return toSession(user, m.active, activeTenantCookie);
}
