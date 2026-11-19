import { getSession } from "@/lib/auth";
import { getData } from "@/lib/data";
import { ChannelsClient, type AccountView } from "./ChannelsClient";

export const dynamic = "force-dynamic";

export default async function ChannelsPage() {
  const s = await getSession();
  if (!s) return null; // layout already redirects
  const accounts: AccountView[] = await Promise.all((["whatsapp", "instagram", "messenger"] as const).map(async (ch) => {
    const a = await getData().channels.get(s.tenantId, ch);
    return { channel: ch, status: a.status, name: String(a.publicInfo.displayName ?? a.publicInfo.externalId ?? "") };
  }));
  const base = (process.env.PUBLIC_URL || "http://localhost:3000").replace(/\/$/, "");
  return <ChannelsClient accounts={accounts} webhookUrl={`${base}/api/webhooks/meta`} verifyToken={process.env.META_VERIFY_TOKEN ?? ""} />;
}
