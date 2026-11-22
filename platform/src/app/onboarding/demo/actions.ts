"use server";
// "Crear negocio demo" / "Borrar negocio demo" (Supabase mode). Any signed-in user may create a demo business: it is
// created with create_tenant under the USER's session (the caller becomes owner; the 5-business limit, reserved names
// and the suspended-account check stay in the database), then filled with fake sample data by the server.
// Deleting needs: signed in, OWNER of the ACTIVE tenant, and the tenant carries the demo mark (lib/demo/business).
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { z } from "zod";
import { getAuthState, getSession } from "@/lib/auth";
import { authBackend } from "@/lib/auth/backend";
import { ACTIVE_TENANT_COOKIE, baseCookieOptions } from "@/lib/auth/cookies";
import { isReservedName } from "@/lib/auth/slug";
import { getData } from "@/lib/data";
import { hit } from "@/lib/security/rate-limit";
import { deleteDemoBusiness, demoSlug, seedDemoBusiness } from "@/lib/demo/business";
import { DEMO_TEMPLATES, isDemoTemplate } from "@/lib/demo/templates";

export type DemoState = { error?: "name" | "template" | "limit" | "rate" | "suspended" | "failed" };

const Name = z.string().trim().min(1).max(120);

export async function createDemoBusinessAction(_prev: DemoState, form: FormData): Promise<DemoState> {
  if (authBackend() !== "supabase") return { error: "failed" };
  const st = await getAuthState();
  if (st.status === "anonymous") redirect("/login?next=%2Fonboarding%2Fdemo");
  if (st.status === "no_tenant" && st.suspended) return { error: "suspended" };
  const userId = st.status === "ok" ? st.session.userId : st.user.id;

  const template = form.get("template");
  if (!isDemoTemplate(template)) return { error: "template" };
  const name = Name.safeParse(form.get("name") || DEMO_TEMPLATES[template].defaultName);
  if (!name.success || isReservedName(name.data)) return { error: "name" };
  if (!(await hit(`demo-business:${userId}`, 10, 24 * 60 * 60_000)).ok) return { error: "rate" };

  const [{ createSupabaseServerClient }, { createTenant }] = await Promise.all([
    import("@/lib/auth/supabase-server"), import("@/lib/auth/team"),
  ]);
  const client = await createSupabaseServerClient();
  let r = await createTenant(client, name.data, demoSlug());
  if (!r.ok && r.error === "slug_taken") r = await createTenant(client, name.data, demoSlug()); // random clash: retry once
  if (!r.ok) return { error: r.error === "limit" ? "limit" : r.error === "name_reserved" ? "name" : "failed" };

  try {
    await seedDemoBusiness(r.tenantId, template, name.data);
  } catch {
    console.error("[demo business] seed failed"); // the business exists and carries the demo mark: it can be deleted
  }
  await getData().audit.log(r.tenantId, userId, "demo.business.create", template);
  (await cookies()).set(ACTIVE_TENANT_COOKIE, r.tenantId, { ...baseCookieOptions(), maxAge: 60 * 60 * 24 * 365 });
  redirect("/dashboard");
}

export type DeleteDemoState = { error?: "auth" | "owner" | "not_demo" | "legal_hold" | "failed" };

export async function deleteDemoBusinessAction(_prev: DeleteDemoState, _form: FormData): Promise<DeleteDemoState> {
  void _form;
  const s = await getSession();
  if (!s) return { error: "auth" };
  if (s.role !== "owner") return { error: "owner" };
  const tenantId = s.tenantId;
  const r = await deleteDemoBusiness(tenantId, s.userId);
  if (!r.ok) return { error: r.error };
  // Next request picks another business of this user (or onboarding when none is left).
  const other = s.tenants.find((t) => t.id !== tenantId);
  const jar = await cookies();
  if (other) jar.set(ACTIVE_TENANT_COOKIE, other.id, { ...baseCookieOptions(), maxAge: 60 * 60 * 24 * 365 });
  else jar.delete(ACTIVE_TENANT_COOKIE);
  redirect("/dashboard");
}
