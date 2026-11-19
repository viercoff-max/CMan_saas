"use server";
// Team management (Supabase mode). Every action: requireRole("admin") on the ACTIVE tenant first, then the USER-session
// client (RLS is the second check). Only createInvitation uses the service role, after its own admin check.
// Never log emails, tokens or links.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole } from "@/lib/auth";
import { authBackend } from "@/lib/auth/backend";

export type TeamActionResult = { ok: true } | { ok: false; error: "invalid" | "failed" | "forbidden" | "unsupported" };
export type InviteActionResult = { ok: true; link: string } | { ok: false; error: "invalid" | "failed" | "forbidden" | "unsupported" };

const RoleIn = z.enum(["admin", "agent"]);
const Uuid = z.uuid();

async function userClient() {
  const { createSupabaseServerClient } = await import("@/lib/auth/supabase-server");
  return createSupabaseServerClient();
}

export async function inviteMemberAction(input: unknown): Promise<InviteActionResult> {
  const s = await requireRole("admin");
  if (authBackend() !== "supabase") return { ok: false, error: "unsupported" };
  const p = z.object({ email: z.string().max(320), role: RoleIn }).safeParse(input);
  if (!p.success) return { ok: false, error: "invalid" };
  const [{ createInvitation }, { appBaseUrl }] = await Promise.all([import("@/lib/auth/invitations"), import("@/lib/auth/base-url")]);
  const r = await createInvitation({ userClient: await userClient(), baseUrl: await appBaseUrl() }, { tenantId: s.tenantId, email: p.data.email, role: p.data.role });
  if (r.ok) revalidatePath("/team");
  return r;
}

export async function changeRoleAction(input: unknown): Promise<TeamActionResult> {
  const s = await requireRole("admin");
  if (authBackend() !== "supabase") return { ok: false, error: "unsupported" };
  const p = z.object({ userId: Uuid, role: RoleIn }).safeParse(input);
  if (!p.success || p.data.userId === s.userId) return { ok: false, error: "invalid" }; // no self-demotion lockout
  const { changeMemberRole } = await import("@/lib/auth/team");
  const ok = await changeMemberRole(await userClient(), s.tenantId, p.data.userId, p.data.role);
  revalidatePath("/team");
  return ok ? { ok: true } : { ok: false, error: "failed" };
}

export async function removeMemberAction(input: unknown): Promise<TeamActionResult> {
  const s = await requireRole("admin");
  if (authBackend() !== "supabase") return { ok: false, error: "unsupported" };
  const p = z.object({ userId: Uuid }).safeParse(input);
  if (!p.success || p.data.userId === s.userId) return { ok: false, error: "invalid" };
  const { removeMember } = await import("@/lib/auth/team");
  const ok = await removeMember(await userClient(), s.tenantId, p.data.userId);
  revalidatePath("/team");
  return ok ? { ok: true } : { ok: false, error: "failed" };
}

export async function revokeInviteAction(input: unknown): Promise<TeamActionResult> {
  const s = await requireRole("admin");
  if (authBackend() !== "supabase") return { ok: false, error: "unsupported" };
  const p = z.object({ id: Uuid }).safeParse(input);
  if (!p.success) return { ok: false, error: "invalid" };
  const { revokeInvite } = await import("@/lib/auth/team");
  const ok = await revokeInvite(await userClient(), s.tenantId, p.data.id);
  revalidatePath("/team");
  return ok ? { ok: true } : { ok: false, error: "failed" };
}
