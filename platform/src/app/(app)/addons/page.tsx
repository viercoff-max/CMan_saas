import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { getAddon, getChannelAccount } from "@/lib/store";
import { getLocale, makeT } from "@/lib/i18n";
import { PageHeader } from "@/components/ui";
import { oauthConfigured } from "@/lib/shopify/config";
import { dict } from "./dict";
import { AddonsClient } from "./AddonsClient";

export default async function Page({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const session = await getSession();
  if (!session) redirect("/login");
  const locale = await getLocale();
  const t = makeT(dict, locale);
  const { notice } = await searchParams;
  const addon = getAddon(session.tenantId, "shopify");
  const noticeKey = notice === "shopify_connected" || notice === "shopify_error" ? `notice.${notice}` : null;

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <AddonsClient
        connected={addon.status === "connected"}
        connectedAt={addon.connectedAt}
        info={{
          name: String(addon.publicInfo.name ?? ""),
          shop: String(addon.publicInfo.shop ?? ""),
          mock: addon.publicInfo.mock === true,
        }}
        oauth={oauthConfigured()}
        channelsConnected={(["whatsapp", "instagram", "messenger"] as const).some((c) => getChannelAccount(session.tenantId, c).status === "connected")}
        notice={noticeKey ? { text: t(noticeKey), ok: notice === "shopify_connected" } : null}
      />
    </>
  );
}
