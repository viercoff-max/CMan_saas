"use server";
// Onboarding step 1 "Tu negocio": public.create_tenant(p_name, p_slug) with the USER's session (the caller becomes
// owner; the RPC also creates agent_settings / brand_settings). Supabase mode only.
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";
import { getAuthState, logout } from "@/lib/auth";
import { authBackend } from "@/lib/auth/backend";
import { ACTIVE_TENANT_COOKIE, baseCookieOptions } from "@/lib/auth/cookies";
import { isValidSlug } from "@/lib/auth/slug";

export type OnboardingState = { error?: "name" | "slug_format" | "slug_taken" | "limit" | "failed" };

const Name = z.string().trim().min(1).max(120);

export async function createTenantAction(_prev: OnboardingState, form: FormData): Promise<OnboardingState> {
  if (authBackend() !== "supabase") redirect("/dashboard");
  const st = await getAuthState();
  if (st.status === "anonymous") redirect("/login?next=%2Fonboarding");
  const name = Name.safeParse(form.get("name"));
  if (!name.success) return { error: "name" };
  const slug = String(form.get("slug") ?? "").trim().toLowerCase();
  if (!isValidSlug(slug)) return { error: "slug_format" };

  const [{ createSupabaseServerClient }, { createTenant }] = await Promise.all([
    import("@/lib/auth/supabase-server"), import("@/lib/auth/team"),
  ]);
  const r = await createTenant(await createSupabaseServerClient(), name.data, slug);
  if (!r.ok) return { error: r.error === "slug_taken" ? "slug_taken" : r.error === "limit" ? "limit" : "failed" };
  (await cookies()).set(ACTIVE_TENANT_COOKIE, r.tenantId, { ...baseCookieOptions(), maxAge: 60 * 60 * 24 * 365 });
  redirect("/dashboard");
}

export async function onboardingLogout() {
  await logout();
  redirect("/login");
}
