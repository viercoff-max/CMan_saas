// Creating an invitation: the ONLY place in auth code that uses the service-role (secret) key, because
// public.invitations has no client INSERT policy. Server-only (never import from a client component).
// Order of checks: the caller's own session proves they are owner/admin of THAT tenant (RLS-scoped read), only then
// the service client inserts the row. Only the SHA-256 hash of the token is stored; the plain link is returned once.
// No email is sent yet: the admin copies the link. Never log the email, token or link.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { supabasePublicEnv } from "./backend";
import { newInviteToken } from "./invite-token";
import { hasRole } from "./roles";
import { supabaseUser } from "./supabase-session";

export type InviteRole = "admin" | "agent";
export type CreateInviteResult = { ok: true; link: string } | { ok: false; error: "forbidden" | "invalid" | "failed" };

const Input = z.object({
  tenantId: z.string().min(1).max(64),
  email: z.string().trim().toLowerCase().max(320).pipe(z.email()),
  role: z.enum(["admin", "agent"]),
});

export function createServiceClient(env: Record<string, string | undefined> = process.env): SupabaseClient {
  const pub = supabasePublicEnv(env);
  const secret = env.SUPABASE_SECRET_KEY?.trim();
  if (!pub || !secret) throw new Error("supabase_not_configured");
  return createClient(pub.url, secret, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

export async function createInvitation(
  deps: { userClient: SupabaseClient; serviceClient?: () => SupabaseClient; baseUrl: string },
  input: { tenantId: string; email: string; role: string },
): Promise<CreateInviteResult> {
  const p = Input.safeParse(input);
  if (!p.success) return { ok: false, error: "invalid" };
  const { tenantId, email, role } = p.data;

  // 1. Caller must be owner/admin of this tenant, proven with THEIR session (RLS applies).
  const user = await supabaseUser(deps.userClient);
  if (!user) return { ok: false, error: "forbidden" };
  const { data: me, error: meErr } = await deps.userClient
    .from("tenant_members").select("role").eq("tenant_id", tenantId).eq("user_id", user.id).maybeSingle();
  if (meErr || !hasRole((me as { role?: string } | null)?.role, "admin")) return { ok: false, error: "forbidden" };

  // 2. One live link per email: older pending invitations for the same address are revoked (admin delete policy).
  await deps.userClient.from("invitations").delete().eq("tenant_id", tenantId).eq("email", email).is("accepted_at", null);

  // 3. Insert with the service role. Only the hash is stored.
  const { token, hash } = newInviteToken();
  const service = (deps.serviceClient ?? createServiceClient)();
  const { error } = await service.from("invitations").insert({ tenant_id: tenantId, email, role, token_hash: hash, invited_by: user.id });
  if (error) return { ok: false, error: "failed" };

  return { ok: true, link: `${deps.baseUrl.replace(/\/+$/, "")}/auth/invite?token=${encodeURIComponent(token)}` };
}
