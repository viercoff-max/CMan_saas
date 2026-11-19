// Team management in Supabase mode, always through the USER-session client (RLS: members_update / members_delete /
// invitations_select / invitations_delete only let owner/admin act, and never on the owner row).
// Callers (team/actions.ts) also run requireRole("admin") first; RLS is the backstop.
import type { SupabaseClient } from "@supabase/supabase-js";
import { isRole, type Role } from "./roles";

export interface TeamMember { userId: string; role: Role; createdAt: string }
export interface PendingInvite { id: string; email: string; role: "admin" | "agent"; createdAt: string; expiresAt: string }

export async function listTeam(client: SupabaseClient, tenantId: string): Promise<TeamMember[]> {
  const { data, error } = await client.from("tenant_members").select("user_id, role, created_at")
    .eq("tenant_id", tenantId).order("created_at", { ascending: true });
  if (error) throw new Error("team_lookup_failed");
  return ((data ?? []) as { user_id: string; role: string; created_at: string }[])
    .filter((r) => isRole(r.role))
    .map((r) => ({ userId: r.user_id, role: r.role as Role, createdAt: r.created_at }));
}

export async function listPendingInvites(client: SupabaseClient, tenantId: string): Promise<PendingInvite[]> {
  const { data, error } = await client.from("invitations").select("id, email, role, created_at, expires_at")
    .eq("tenant_id", tenantId).is("accepted_at", null).gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });
  if (error) return [];
  return ((data ?? []) as { id: string; email: string; role: "admin" | "agent"; created_at: string; expires_at: string }[])
    .map((r) => ({ id: r.id, email: r.email, role: r.role, createdAt: r.created_at, expiresAt: r.expires_at }));
}

/** admin <-> agent. Returns false when nothing changed (owner row, other tenant, not allowed by RLS). */
export async function changeMemberRole(client: SupabaseClient, tenantId: string, userId: string, role: "admin" | "agent"): Promise<boolean> {
  const { data, error } = await client.from("tenant_members").update({ role })
    .eq("tenant_id", tenantId).eq("user_id", userId).neq("role", "owner").select("user_id");
  return !error && Array.isArray(data) && data.length === 1;
}

export async function removeMember(client: SupabaseClient, tenantId: string, userId: string): Promise<boolean> {
  const { data, error } = await client.from("tenant_members").delete()
    .eq("tenant_id", tenantId).eq("user_id", userId).neq("role", "owner").select("user_id");
  return !error && Array.isArray(data) && data.length === 1;
}

export async function revokeInvite(client: SupabaseClient, tenantId: string, inviteId: string): Promise<boolean> {
  const { data, error } = await client.from("invitations").delete()
    .eq("tenant_id", tenantId).eq("id", inviteId).is("accepted_at", null).select("id");
  return !error && Array.isArray(data) && data.length === 1;
}

export type AcceptResult = { ok: true; tenantId: string } | { ok: false };
/** public.accept_invitation checks the token hash, expiry and that the signed-in email matches the invitation. */
export async function acceptInvite(client: SupabaseClient, token: string): Promise<AcceptResult> {
  const { data, error } = await client.rpc("accept_invitation", { p_token: token });
  return !error && typeof data === "string" ? { ok: true, tenantId: data } : { ok: false };
}

export type CreateTenantResult = { ok: true; tenantId: string } | { ok: false; error: "slug_taken" | "limit" | "failed" };
export async function createTenant(client: SupabaseClient, name: string, slug: string): Promise<CreateTenantResult> {
  const { data, error } = await client.rpc("create_tenant", { p_name: name, p_slug: slug });
  if (!error && typeof data === "string") return { ok: true, tenantId: data };
  if (error?.code === "23505") return { ok: false, error: "slug_taken" };
  if (error?.message?.includes("tenant_limit_reached")) return { ok: false, error: "limit" };
  return { ok: false, error: "failed" };
}
