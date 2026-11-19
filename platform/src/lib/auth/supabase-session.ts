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

export async function listMemberships(client: SupabaseClient, userId: string): Promise<TenantMembership[]> {
  const { data, error } = await client
    .from("tenant_members")
    .select("tenant_id, role, created_at, tenants(name, status)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });
  if (error) throw new Error("membership_lookup_failed"); // fail closed, no details
  const out: TenantMembership[] = [];
  for (const r of (data ?? []) as MemberRow[]) {
    const t = Array.isArray(r.tenants) ? r.tenants[0] : r.tenants;
    if (!t || t.status === "deleted" || !isRole(r.role) || typeof r.tenant_id !== "string") continue;
    out.push({ id: r.tenant_id, name: String(t.name ?? ""), role: r.role });
  }
  return out;
}

/** Full resolution for one request: user -> memberships -> active tenant (cookie checked against memberships). */
export async function resolveSupabaseAuth(client: SupabaseClient, activeTenantCookie: string | null | undefined): Promise<AuthState> {
  const user = await supabaseUser(client);
  if (!user) return { status: "anonymous" };
  return toSession(user, await listMemberships(client, user.id), activeTenantCookie);
}
