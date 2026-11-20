"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { assertRole, getSession } from "@/lib/auth";
import { DataConflictError, getData } from "@/lib/data";
import { testChannelCredentials, type GraphFailure } from "./graph-test";
import {
  isTelegramBotToken, telegramDeleteWebhook, telegramGetMe, telegramSetWebhook, telegramWebhookReachable, telegramWebhookUrl,
  type TelegramFailure,
} from "@/lib/channels/telegram";
import { newTelegramWebhookSecret, type TelegramChannelSecrets } from "@/lib/channels/telegram-secret";
import { APP_SECRET_SHAPE, newWhatsAppVerifyToken, type WhatsAppChannelSecrets } from "@/lib/channels/whatsapp-own";
import { whatsappPlatformReady } from "@/lib/platform/channels";

const id = z.string().trim().min(3).max(64).regex(/^[A-Za-z0-9_.-]+$/);
const token = z.string().trim().min(10).max(1024);

const Schemas = {
  // appSecret: the business's OWN Meta app (manual mode). Empty = the platform's Meta app (when configured).
  whatsapp: z.object({ externalId: id, accessToken: token, wabaId: id, appSecret: z.string().trim().max(200).optional() }),
  instagram: z.object({ externalId: id, accessToken: token }),
  messenger: z.object({ externalId: id, accessToken: token }),
} as const;
type Ch = keyof typeof Schemas;
const isCh = (c: string): c is Ch => c in Schemas;

export type ConnectResult = { ok: true; name: string } | { ok: false; error: GraphFailure | "invalid" | "auth" | "in_use" | "app_secret" };

/**
 * Tests the credentials against the Graph API first (and subscribes the app to the account's webhooks); stores the
 * channel as connected only if both pass.
 */
export async function connectChannel(channel: string, input: unknown): Promise<ConnectResult> {
  const s = await getSession();
  if (!s || !isCh(channel)) return { ok: false, error: "auth" };
  assertRole(s, "admin"); // agents: 403
  const p = Schemas[channel].safeParse(input);
  if (!p.success) return { ok: false, error: "invalid" };
  const d = p.data as { externalId: string; accessToken: string; wabaId?: string; appSecret?: string };
  // WhatsApp: own-app mode when an App Secret is given; it is REQUIRED while the platform Meta app is not configured.
  const appSecret = channel === "whatsapp" ? (d.appSecret ?? "").trim() : "";
  if (channel === "whatsapp" && (appSecret ? !APP_SECRET_SHAPE.test(appSecret) : !whatsappPlatformReady())) return { ok: false, error: "app_secret" };

  // One Page / IG account / WhatsApp number belongs to ONE brand (webhook routing). Checked before calling Graph, and the
  // unique index uq_channel_external (db.ts) is the race-proof backstop below.
  const data = getData();
  const owner = await data.channels.findTenantByExternalId(channel, d.externalId);
  if (owner && owner !== s.tenantId) {
    await data.audit.log(s.tenantId, s.userId, "channel.connect_failed", `${channel}:in_use`);
    return { ok: false, error: "in_use" };
  }

  const test = await testChannelCredentials(channel, d);
  if (!test.ok) {
    await data.audit.log(s.tenantId, s.userId, "channel.connect_failed", `${channel}:${test.error}`);
    return { ok: false, error: test.error };
  }

  const data0 = channel === "whatsapp" && appSecret ? await data.secrets.get<WhatsAppChannelSecrets>(s.tenantId, "channel", "whatsapp") : null;
  const secrets = channel === "whatsapp"
    ? {
      phoneNumberId: d.externalId, accessToken: d.accessToken, wabaId: d.wabaId,
      // Reconnecting keeps the verify token already pasted in the Meta app; a first connection gets a new one.
      ...(appSecret ? { appSecret, verifyToken: data0?.verifyToken || newWhatsAppVerifyToken() } : {}),
    }
    : channel === "instagram"
      ? { igId: d.externalId, accessToken: d.accessToken, ...(test.igLogin ? { igLogin: "1" } : {}) }
      : { pageId: d.externalId, accessToken: d.accessToken };
  try {
    // Status first: a conflict (another tenant owns this account) must not leave our token stored.
    await data.channels.save(s.tenantId, channel, {
      status: "connected", publicInfo: {
        externalId: d.externalId, displayName: test.name,
        ...(channel === "whatsapp" ? { mode: appSecret ? "own_app" : "platform", webhook: appSecret ? "pending" : "ok" } : {}),
      },
    });
  } catch (e) {
    if (e instanceof DataConflictError) {
      await data.audit.log(s.tenantId, s.userId, "channel.connect_failed", `${channel}:in_use`);
      return { ok: false, error: "in_use" };
    }
    throw e;
  }
  await data.secrets.set(s.tenantId, "channel", channel, secrets);
  await data.audit.log(s.tenantId, s.userId, "channel.connect", channel);
  revalidatePath("/channels");
  return { ok: true, name: test.name };
}

export async function disconnectChannel(channel: string): Promise<{ ok: boolean }> {
  const s = await getSession();
  if (!s || !isCh(channel)) return { ok: false };
  assertRole(s, "admin"); // agents: 403
  const data = getData();
  await data.channels.save(s.tenantId, channel, { status: "disconnected", publicInfo: {} });
  await data.secrets.clear(s.tenantId, "channel", channel);
  await data.audit.log(s.tenantId, s.userId, "channel.disconnect", channel);
  revalidatePath("/channels");
  return { ok: true };
}

// ---------------- Telegram ----------------
// Connect order (docs/ARCHITECTURE.md "Wave 1 additions"): getMe -> channels.save(connected) [conflict = another brand
// owns this bot] -> secrets.set({botToken, webhookSecret}) -> setWebhook(url with the row's webhookId, secret_token).
// The token is never logged, returned or put in audit details.
export type TelegramWebhookState = "ok" | "needs_https" | "failed";
export type TelegramConnectResult =
  | { ok: true; username: string; webhook: TelegramWebhookState }
  | { ok: false; error: "invalid" | "auth" | "token" | "network" | "rate" | "in_use" | "unknown" };

const TelegramInput = z.object({ botToken: z.string().trim().max(200) });

function telegramFailure(e: TelegramFailure): "token" | "network" | "rate" | "unknown" {
  return e === "token" ? "token" : e === "network" || e === "timeout" ? "network" : e === "rate" ? "rate" : "unknown";
}

/** setWebhook for the tenant's stored bot (or report why Telegram cannot reach us). */
async function registerTelegramWebhook(tenantId: string, token: string, secret: string): Promise<TelegramWebhookState> {
  const publicUrl = process.env.PUBLIC_URL;
  if (!telegramWebhookReachable(publicUrl)) return "needs_https";
  const webhookId = (await getData().channels.get(tenantId, "telegram")).webhookId;
  if (!webhookId) return "failed";
  const r = await telegramSetWebhook(token, { url: telegramWebhookUrl(publicUrl!, webhookId), secretToken: secret });
  return r.ok ? "ok" : "failed";
}

async function markWebhook(tenantId: string, state: TelegramWebhookState) {
  const data = getData();
  const a = await data.channels.get(tenantId, "telegram");
  if (a.status !== "connected") return;
  await data.channels.save(tenantId, "telegram", { status: "connected", publicInfo: { ...a.publicInfo, webhook: state } });
}

export async function connectTelegram(input: unknown): Promise<TelegramConnectResult> {
  const s = await getSession();
  if (!s) return { ok: false, error: "auth" };
  assertRole(s, "admin"); // agents: 403
  const p = TelegramInput.safeParse(input);
  if (!p.success || !isTelegramBotToken(p.data.botToken)) return { ok: false, error: "invalid" };
  const botToken = p.data.botToken;
  const data = getData();

  const me = await telegramGetMe(botToken);
  if (!me.ok) {
    await data.audit.log(s.tenantId, s.userId, "channel.connect_failed", `telegram:${telegramFailure(me.error)}`);
    return { ok: false, error: telegramFailure(me.error) };
  }
  const bot = me.result;
  const previous = await data.secrets.get<TelegramChannelSecrets>(s.tenantId, "channel", "telegram");

  try {
    // Status first: a conflict (another tenant has this bot connected) must not leave our token stored.
    await data.channels.save(s.tenantId, "telegram", {
      status: "connected",
      publicInfo: { externalId: bot.id, displayName: `@${bot.username}`, username: bot.username, connectedAt: new Date().toISOString(), webhook: "failed" },
    });
  } catch (e) {
    if (e instanceof DataConflictError) {
      await data.audit.log(s.tenantId, s.userId, "channel.connect_failed", "telegram:in_use");
      return { ok: false, error: "in_use" };
    }
    throw e;
  }
  const webhookSecret = newTelegramWebhookSecret();
  await data.secrets.set(s.tenantId, "channel", "telegram", { botToken, webhookSecret });

  // Switched to a different bot: stop the old one from calling us (best effort; its secret no longer matches anyway).
  if (previous?.botToken && previous.botToken !== botToken) await telegramDeleteWebhook(previous.botToken);

  const webhook = await registerTelegramWebhook(s.tenantId, botToken, webhookSecret);
  await markWebhook(s.tenantId, webhook);
  await data.audit.log(s.tenantId, s.userId, "channel.connect", `telegram:webhook_${webhook}`);
  revalidatePath("/channels");
  return { ok: true, username: bot.username, webhook };
}

/** "Volver a registrar webhook": after PUBLIC_URL changed (new tunnel) or a failed setWebhook. Rotates the secret. */
export async function reregisterTelegramWebhook(): Promise<{ ok: boolean; webhook?: TelegramWebhookState; error?: "auth" | "not_connected" }> {
  const s = await getSession();
  if (!s) return { ok: false, error: "auth" };
  assertRole(s, "admin");
  const data = getData();
  const a = await data.channels.get(s.tenantId, "telegram");
  const sec = await data.secrets.get<TelegramChannelSecrets>(s.tenantId, "channel", "telegram");
  if (a.status !== "connected" || !sec?.botToken) return { ok: false, error: "not_connected" };
  const webhookSecret = newTelegramWebhookSecret();
  await data.secrets.set(s.tenantId, "channel", "telegram", { botToken: sec.botToken, webhookSecret });
  const webhook = await registerTelegramWebhook(s.tenantId, sec.botToken, webhookSecret);
  await markWebhook(s.tenantId, webhook);
  await data.audit.log(s.tenantId, s.userId, "channel.webhook_registered", `telegram:${webhook}`);
  revalidatePath("/channels");
  return { ok: true, webhook };
}

export async function disconnectTelegram(): Promise<{ ok: boolean }> {
  const s = await getSession();
  if (!s) return { ok: false };
  assertRole(s, "admin");
  const data = getData();
  const sec = await data.secrets.get<TelegramChannelSecrets>(s.tenantId, "channel", "telegram");
  if (sec?.botToken) await telegramDeleteWebhook(sec.botToken); // best effort: we clear our side regardless
  await data.secrets.clear(s.tenantId, "channel", "telegram");
  await data.channels.save(s.tenantId, "telegram", { status: "disconnected", publicInfo: {} });
  await data.audit.log(s.tenantId, s.userId, "channel.disconnect", "telegram");
  revalidatePath("/channels");
  return { ok: true };
}
