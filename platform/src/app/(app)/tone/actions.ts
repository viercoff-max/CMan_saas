"use server";
import { z } from "zod";
import { requireSession } from "@/lib/auth";
import { audit, saveAgentSettings } from "@/lib/store";
import { serializeBusinessHours, storableCustomText } from "@/lib/context/settings";

const hhmm = /^([01]\d|2[0-3]):[0-5]\d$/;
const schema = z.object({
  agentName: z.string().trim().min(1).max(60),
  toneLevel: z.number().int().min(1).max(5),
  languageDefault: z.enum(["es", "en"]),
  greeting: z.string().trim().max(500),
  fallbackMessage: z.string().trim().max(800),
  handoffEmail: z.union([z.literal(""), z.string().trim().max(200).pipe(z.email())]),
  crossSellLevel: z.number().int().min(0).max(3),
  hours: z.object({
    fromDay: z.number().int().min(1).max(7),
    toDay: z.number().int().min(1).max(7),
    open: z.string().regex(hhmm),
    close: z.string().regex(hhmm),
    timezone: z.string().trim().min(1).max(64).refine((tz) => {
      try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; }
    }),
    // close <= open is an overnight range (closes after midnight); identical times make no sense.
  }).refine((h) => h.open !== h.close),
});

export type SaveToneResult = { ok: true; greeting: string; fallbackMessage: string } | { ok: false; error: "invalid" };

export async function saveToneAction(input: unknown): Promise<SaveToneResult> {
  const s = await requireSession();
  const p = schema.safeParse(input);
  if (!p.success) return { ok: false, error: "invalid" };
  const d = p.data;
  // Store only what the user wrote. "" lets the engine use its tone-aware templates (agent name, usted/tú, emoji).
  const greeting = storableCustomText(d.greeting, "greeting");
  const fallbackMessage = storableCustomText(d.fallbackMessage, "fallback");
  saveAgentSettings(s.tenantId, {
    agentName: d.agentName,
    toneLevel: d.toneLevel as 1 | 2 | 3 | 4 | 5,
    languageDefault: d.languageDefault,
    languageAlt: d.languageDefault === "es" ? "en" : "es",
    greeting,
    fallbackMessage,
    handoffEmail: d.handoffEmail,
    crossSellLevel: d.crossSellLevel as 0 | 1 | 2 | 3,
    businessHours: serializeBusinessHours(d.hours),
  });
  audit(s.tenantId, s.userId, "settings.save", "tone");
  return { ok: true, greeting, fallbackMessage };
}
