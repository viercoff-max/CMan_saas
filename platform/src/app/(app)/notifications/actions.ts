"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { getData } from "@/lib/data";

const Prefs = z.object({ waiting: z.boolean(), urgent: z.boolean(), assigned: z.boolean() });

/** The signed-in person's notice preferences in the ACTIVE business. */
export async function saveNotificationPrefs(input: unknown): Promise<{ ok: boolean }> {
  const s = await requireSession();
  const p = Prefs.safeParse(input);
  if (!p.success) return { ok: false };
  await getData().push.savePrefs(s.tenantId, s.userId, p.data);
  revalidatePath("/notifications");
  return { ok: true };
}

/** Remove one of the person's own devices (by its row id) in the active business. */
export async function removeDevice(input: unknown): Promise<{ ok: boolean }> {
  const s = await requireSession();
  const p = z.object({ id: z.string().min(1).max(64) }).safeParse(input);
  if (!p.success) return { ok: false };
  const data = getData();
  const dev = (await data.push.listDevices(s.tenantId, s.userId)).find((d) => d.id === p.data.id);
  if (!dev) return { ok: false };
  const ok = await data.push.unsubscribe(s.tenantId, s.userId, dev.endpoint);
  revalidatePath("/notifications");
  return { ok };
}
