import { getSession, hasRole } from "@/lib/auth";
import { getData } from "@/lib/data";
import { maskTelegramToken, telegramWebhookReachable } from "@/lib/channels/telegram";
import type { TelegramChannelSecrets } from "@/lib/channels/telegram-secret";
import { whatsappWebhookUrl, type WhatsAppChannelSecrets } from "@/lib/channels/whatsapp-own";
import { PLATFORM_BRAND } from "@/lib/platform/brand";
import { manychatEndpointUrl, type ManychatSecrets } from "@/lib/channels/manychat";
import { isChannelAvailable, whatsappPlatformReady } from "@/lib/platform/channels";
import { ChannelsClient, type AccountView, type ManychatView, type TelegramView, type WhatsAppView } from "./ChannelsClient";

export const dynamic = "force-dynamic";

export default async function ChannelsPage() {
  const s = await getSession();
  if (!s) return null; // layout already redirects
  const data = getData();
  const accounts: AccountView[] = await Promise.all((["whatsapp", "instagram", "messenger"] as const).map(async (ch) => {
    const a = await data.channels.get(s.tenantId, ch);
    return { channel: ch, status: a.status, name: String(a.publicInfo.displayName ?? a.publicInfo.externalId ?? ""), available: isChannelAvailable(ch) };
  }));

  const tg = await data.channels.get(s.tenantId, "telegram");
  const connected = tg.status === "connected";
  // Only a masked hint of the token ever leaves the server ("7412••••••••Qx").
  const token = connected ? (await data.secrets.get<TelegramChannelSecrets>(s.tenantId, "channel", "telegram"))?.botToken : undefined;
  const w = String(tg.publicInfo.webhook ?? "");
  const telegram: TelegramView = {
    status: tg.status,
    username: connected ? String(tg.publicInfo.username ?? "") : "",
    connectedAt: connected ? String(tg.publicInfo.connectedAt ?? "") : "",
    webhook: w === "ok" || w === "needs_https" ? w : "failed",
    tokenHint: token ? maskTelegramToken(token) : "",
    reachable: telegramWebhookReachable(process.env.PUBLIC_URL),
    canEdit: hasRole(s.role, "admin"),
  };

  // WhatsApp (beta): always available with the business's OWN Meta app (manual). The platform app is optional
  // (META_APP_SECRET + META_VERIFY_TOKEN). The per-tenant webhook URL and verify token are shown to admins only.
  const wa = await data.channels.get(s.tenantId, "whatsapp");
  const waConnected = wa.status === "connected";
  const canEdit = hasRole(s.role, "admin");
  const ownApp = waConnected && wa.publicInfo.mode === "own_app";
  const waSecrets = ownApp && canEdit ? await data.secrets.get<WhatsAppChannelSecrets>(s.tenantId, "channel", "whatsapp") : null;
  const whatsapp: WhatsAppView = {
    enabled: true, platformReady: whatsappPlatformReady(), status: wa.status, canEdit,
    name: waConnected ? String(wa.publicInfo.displayName ?? wa.publicInfo.externalId ?? "") : "",
    mode: ownApp ? "own_app" : waConnected ? "platform" : "none",
    webhook: wa.publicInfo.webhook === "ok" ? "ok" : "pending",
    webhookUrl: canEdit ? whatsappWebhookUrl(process.env.PUBLIC_URL, wa.webhookId) : "",
    verifyToken: waSecrets?.verifyToken ?? "",
    supportEmail: PLATFORM_BRAND.supportEmail ?? PLATFORM_BRAND.privacyContactEmail ?? "",
  };

  // ManyChat: endpoint URL + request token for the business's ManyChat flow (admins only; the API key never leaves).
  const mc = await data.channels.get(s.tenantId, "manychat");
  const mcConnected = mc.status === "connected";
  const mcSecrets = mcConnected && canEdit ? await data.secrets.get<ManychatSecrets>(s.tenantId, "channel", "manychat") : null;
  const manychat: ManychatView = {
    status: mc.status, canEdit, name: mcConnected ? String(mc.publicInfo.displayName ?? "") : "",
    endpointUrl: mcConnected && canEdit ? manychatEndpointUrl(process.env.PUBLIC_URL, mc.webhookId) : "",
    requestToken: mcSecrets?.requestToken ?? "",
  };

  // The platform's Meta webhook URL and META_VERIFY_TOKEN are platform config: never rendered to tenants (L7).
  return <ChannelsClient telegram={telegram} accounts={accounts} whatsapp={whatsapp} manychat={manychat} />;
}
