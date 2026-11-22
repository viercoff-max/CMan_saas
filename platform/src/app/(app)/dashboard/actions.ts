"use server";
// Saves the signed-in person's dashboard cards for the ACTIVE business. Unknown keys are dropped; agents cannot pin
// admin-only cards (plan / AI spend).
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { hasRole, requireSession } from "@/lib/auth";
import { getData } from "@/lib/data";
import { resolveCards } from "@/lib/metrics/dashboard";

const Input = z.object({ cards: z.array(z.string().max(40)).max(40).nullable() });

export async function saveDashboardCards(input: unknown): Promise<{ ok: boolean }> {
  const s = await requireSession();
  const p = Input.safeParse(input);
  if (!p.success) return { ok: false };
  const isAdmin = hasRole(s.role, "admin");
  // null = back to the defaults (stored as the default list so the choice is explicit).
  const cards = resolveCards(p.data.cards, isAdmin);
  await getData().dashboardPrefs.save(s.tenantId, s.userId, cards);
  revalidatePath("/dashboard");
  return { ok: true };
}
