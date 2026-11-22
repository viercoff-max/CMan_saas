"use server";
// Customer record actions. Tenant always comes from the session. Any team member may edit a record; merging two
// records is admin-only (it moves conversations). Ids from another tenant are "not found" in the data layer.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireRole, requireSession } from "@/lib/auth";
import { DataValidationError, getData } from "@/lib/data";

export type CustomerActionResult = { ok: true } | { ok: false; error: "name" | "email" | "phone" | "tags" | "notes" | "failed" | "not_found" };

const Update = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(400), email: z.string().max(400), phone: z.string().max(100),
  tags: z.string().max(2000), notes: z.string().max(8000),
});

export async function updateCustomerAction(input: unknown): Promise<CustomerActionResult> {
  const s = await requireSession();
  const p = Update.safeParse(input);
  if (!p.success) return { ok: false, error: "failed" };
  const tags = p.data.tags.split(",").map((t) => t.trim()).filter(Boolean);
  try {
    const r = await getData().customers.update(s.tenantId, p.data.id, { name: p.data.name, email: p.data.email, phone: p.data.phone, tags, notes: p.data.notes });
    if (!r) return { ok: false, error: "not_found" };
  } catch (e) {
    if (e instanceof DataValidationError && ["name", "email", "phone", "tags", "notes"].includes(e.field)) return { ok: false, error: e.field as "name" };
    return { ok: false, error: "failed" };
  }
  await getData().audit.log(s.tenantId, s.userId, "customer.update", p.data.id);
  revalidatePath(`/customers/${p.data.id}`);
  return { ok: true };
}

const Merge = z.object({ into: z.string().min(1).max(64), from: z.string().min(1).max(64) });

export async function mergeCustomersAction(input: unknown): Promise<CustomerActionResult> {
  const s = await requireRole("admin");
  const p = Merge.safeParse(input);
  if (!p.success || p.data.into === p.data.from) return { ok: false, error: "failed" };
  const ok = await getData().customers.merge(s.tenantId, p.data.from, p.data.into);
  if (!ok) return { ok: false, error: "not_found" };
  await getData().audit.log(s.tenantId, s.userId, "customer.merge", `${p.data.from}->${p.data.into}`);
  revalidatePath("/customers");
  revalidatePath(`/customers/${p.data.into}`);
  return { ok: true };
}
