import { getSession, hasRole } from "@/lib/auth";
import { getData } from "@/lib/data";
import { maskTelegramToken, telegramWebhookReachable } from "@/lib/channels/telegram";
import type { TelegramChannelSecrets } from "@/lib/channels/telegram-secret";
import { isChannelAvailable, whatsappPlatformReady } from "@/lib/platform/channels";
import { ChannelsClient, type AccountView, type TelegramView, type WhatsAppView } from "./ChannelsClient";

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

  // WhatsApp (beta): a form only when the platform Meta app is wired (META_APP_SECRET + META_VERIFY_TOKEN).
  const wa = await data.channels.get(s.tenantId, "whatsapp");
  const whatsapp: WhatsAppView = {
    enabled: whatsappPlatformReady(), status: wa.status, canEdit: hasRole(s.role, "admin"),
    name: wa.status === "connected" ? String(wa.publicInfo.displayName ?? wa.publicInfo.externalId ?? "") : "",
  };

  // The platform's Meta webhook URL and META_VERIFY_TOKEN are platform config: never rendered to tenants (L7).
  return <ChannelsClient telegram={telegram} accounts={accounts} whatsapp={whatsapp} />;
}
