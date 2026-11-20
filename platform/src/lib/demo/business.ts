// Demo BUSINESSES (Supabase mode, production-safe): any signed-in user can create a separate, fake sample business
// from a template to show the product, and delete it later. Unlike `npm run demo` (local only, seeds the existing
// tenant), this only ever writes into a brand-new tenant the user owns (created with create_tenant under the USER's
// session, so the 5-business limit and reserved names still apply). Marked with an audit row actor "demo",
// action "demo.business"; deletion requires that mark AND owner role.
import { getData } from "../data";
import { CONTEXT_SECTION_KEYS } from "../types";
import { deleteSourceAndLinks, reindexSection, serializeBusinessHours } from "../context";
import { removeLogo } from "../storage/logo";
import { telegramDeleteWebhook } from "../channels/telegram";
import type { TelegramChannelSecrets } from "../channels/telegram-secret";
import { DEMO_ACTOR, DEMO_PREFIX } from "./content";
import { writeDemoConversations } from "./index";
import { DEMO_TEMPLATES, type DemoTemplateKey } from "./templates";

export const DEMO_BUSINESS_ACTION = "demo.business";

/** True when the tenant was created as a demo business ("Crear negocio demo"). */
export async function isDemoBusiness(tenantId: string): Promise<boolean> {
  return (await getData().audit.find(tenantId, { actor: DEMO_ACTOR, action: DEMO_BUSINESS_ACTION })) !== null;
}

/** "demo-" + 8 random lowercase chars: a valid, non-reserved slug (create_tenant reserves only the exact word "demo"). */
export function demoSlug(rand: () => number = Math.random): string {
  const abc = "abcdefghijkmnpqrstuvwxyz23456789";
  let s = "";
  for (let i = 0; i < 8; i++) s += abc[Math.floor(rand() * abc.length)];
  return `demo-${s}`;
}

export interface DemoBusinessResult { conversations: number; messages: number; sections: number }

/** Fills a NEW tenant with the template. Caller: the server action, right after create_tenant succeeded. */
export async function seedDemoBusiness(tenantId: string, key: DemoTemplateKey, name: string, now: Date = new Date()): Promise<DemoBusinessResult> {
  const tpl = DEMO_TEMPLATES[key];
  const data = getData();
  // Mark first: if anything below fails, the owner can still delete this half-filled demo.
  await data.audit.log(tenantId, DEMO_ACTOR, DEMO_BUSINESS_ACTION, `template:${key}`);

  const sections = tpl.sections(name);
  for (const k of CONTEXT_SECTION_KEYS) {
    await data.sections.saveContent(tenantId, k, sections[k] ?? "");
    await reindexSection(tenantId, k);
  }
  await data.settings.save(tenantId, {
    agentName: tpl.agentName, toneLevel: tpl.toneLevel, crossSellLevel: tpl.crossSellLevel, greeting: "", fallbackMessage: "",
    languageDefault: "es", languageAlt: "en", businessHours: serializeBusinessHours(tpl.hours),
  });
  if (!(await data.settings.isToneSaved(tenantId))) await data.settings.markToneSaved(tenantId, DEMO_ACTOR);
  await data.brand.save(tenantId, { displayName: name, ...tpl.brand });

  if (tpl.shopify) {
    // Same marker as POST /api/shopify/demo: fake orders #1001-#1004 (email test@example.com), no real store.
    await data.secrets.set(tenantId, "addon", "shopify", { mock: true });
    await data.addons.save(tenantId, "shopify", {
      status: "connected", publicInfo: { shop: "demo.myshopify.com", name: "Tienda de demostración", mock: true, mode: "demo" },
    });
  }
  const convs = tpl.conversations(now, name);
  const messages = await writeDemoConversations(tenantId, convs, now);
  return { conversations: convs.length, messages, sections: CONTEXT_SECTION_KEYS.length };
}

export type DeleteDemoResult = { ok: true } | { ok: false; error: "not_demo" | "legal_hold" | "failed" };

/**
 * Deletes a demo business completely. The CALLER must have checked that the session user is the OWNER of this
 * tenant. Refused when the tenant is not a demo business, or when a REAL customer conversation (not a "demo-"
 * transcript, not the simulator) is under legal hold: that record must be kept (REVIEW-security-2 H1).
 */
export async function deleteDemoBusiness(tenantId: string): Promise<DeleteDemoResult> {
  if (!(await isDemoBusiness(tenantId))) return { ok: false, error: "not_demo" };
  const data = getData();
  const real = (await data.conversations.list(tenantId, { limit: 10_000 }))
    .filter((c) => c.channel !== "simulator" && !c.externalId.startsWith(DEMO_PREFIX));
  const held = (c: (typeof real)[number]) =>
    c.legalHold === true || c.state?.legalHold === true || c.escalationReason === "safety" || c.escalationReason === "legal";
  if (real.some(held)) return { ok: false, error: "legal_hold" };

  // Best-effort clean-up outside the database: uploaded files, logo, a connected Telegram bot's webhook.
  for (const s of await data.sources.list(tenantId)) {
    if (s.kind === "file") await deleteSourceAndLinks(tenantId, s.id).catch(() => undefined);
  }
  const brand = await data.brand.get(tenantId);
  if (brand.logoPath) await removeLogo(tenantId, brand.logoPath).catch(() => undefined);
  const tg = await data.secrets.get<TelegramChannelSecrets>(tenantId, "channel", "telegram").catch(() => null);
  if (tg?.botToken) await telegramDeleteWebhook(tg.botToken).catch(() => undefined);

  try {
    return (await data.tenants.remove(tenantId)) ? { ok: true } : { ok: false, error: "failed" };
  } catch {
    return { ok: false, error: "failed" };
  }
}
