import { getSession } from "@/lib/auth";
import { getChannelAccount } from "@/lib/store";
import { ChannelsClient, type AccountView } from "./ChannelsClient";

export const dynamic = "force-dynamic";

export default async function ChannelsPage() {
  const s = await getSession();
  if (!s) return null; // layout already redirects
  const accounts: AccountView[] = (["whatsapp", "instagram", "messenger"] as const).map((ch) => {
    const a = getChannelAccount(s.tenantId, ch);
    return { channel: ch, status: a.status, name: String(a.publicInfo.displayName ?? a.publicInfo.externalId ?? "") };
  });
  const base = (process.env.PUBLIC_URL || "http://localhost:3000").replace(/\/$/, "");
  return <ChannelsClient accounts={accounts} webhookUrl={`${base}/api/webhooks/meta`} verifyToken={process.env.META_VERIFY_TOKEN ?? ""} />;
}
