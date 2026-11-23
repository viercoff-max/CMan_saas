"use server";
// Platform console actions. Each one re-checks the platform admin inside lib/platform/console.ts (404 otherwise),
// validates its input here, is rate limited and writes an audit row with codes only.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  changePlan, deleteDemoTenant, liftLegalHold, reactivateTenant, setAiCap, suspendTenant, type ActionResult,
} from "@/lib/platform/console";

const id = z.string().min(1).max(80);
const bad: ActionResult = { ok: false, error: "invalid" };
const done = (r: ActionResult, tenantId?: string): ActionResult => {
  if (r.ok) {
    revalidatePath("/platform", "layout");
    if (tenantId) revalidatePath(`/platform/tenants/${tenantId}`);
  }
  return r.ok ? { ok: true } : r; // never send the tenant record back to the browser
};

export async function suspendAction(input: unknown): Promise<ActionResult> {
  const p = z.object({ tenantId: id, reason: z.string().max(40), confirm: z.string().max(80) }).safeParse(input);
  if (!p.success) return bad;
  return done(await suspendTenant(p.data.tenantId, p.data.reason, p.data.confirm), p.data.tenantId);
}

export async function reactivateAction(input: unknown): Promise<ActionResult> {
  const p = z.object({ tenantId: id }).safeParse(input);
  if (!p.success) return bad;
  return done(await reactivateTenant(p.data.tenantId), p.data.tenantId);
}

export async function changePlanAction(input: unknown): Promise<ActionResult> {
  const p = z.object({ tenantId: id, plan: z.string().max(20), reason: z.string().max(40) }).safeParse(input);
  if (!p.success) return bad;
  return done(await changePlan(p.data.tenantId, p.data.plan, p.data.reason), p.data.tenantId);
}

export async function setAiCapAction(input: unknown): Promise<ActionResult> {
  const p = z.object({ tenantId: id, cap: z.number().int().min(0).max(1_000_000_000), reason: z.string().max(40) }).safeParse(input);
  if (!p.success) return bad;
  return done(await setAiCap(p.data.tenantId, p.data.cap, p.data.reason), p.data.tenantId);
}

export async function deleteDemoAction(input: unknown): Promise<ActionResult> {
  const p = z.object({ tenantId: id, confirm: z.string().max(80) }).safeParse(input);
  if (!p.success) return bad;
  return done(await deleteDemoTenant(p.data.tenantId, p.data.confirm));
}

export async function liftHoldAction(input: unknown): Promise<ActionResult> {
  const p = z.object({ tenantId: id, conversationId: id, reason: z.string().max(40) }).safeParse(input);
  if (!p.success) return bad;
  return done(await liftLegalHold(p.data.tenantId, p.data.conversationId, p.data.reason), p.data.tenantId);
}
