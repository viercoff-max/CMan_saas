import { requireAdminPage } from "@/components/guards";
import { getData } from "@/lib/data";
import { getLocale, makeT } from "@/lib/i18n";
import { PageHeader } from "@/components/ui";
import { oauthConfigured } from "@/lib/shopify/config";
import { dict } from "./dict";
import { AddonsClient } from "./AddonsClient";

export default async function Page({ searchParams }: { searchParams: Promise<{ notice?: string }> }) {
  const session = await requireAdminPage(); // agents are redirected to /inbox before anything renders
  const locale = await getLocale();
  const t = makeT(dict, locale);
  const { notice } = await searchParams;
  const data = getData();
  const addon = await data.addons.get(session.tenantId, "shopify");
  const channelsConnected = (await Promise.all((["whatsapp", "instagram", "messenger"] as const).map((c) => data.channels.get(session.tenantId, c))))
    .some((a) => a.status === "connected");
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
        channelsConnected={channelsConnected}
        notice={noticeKey ? { text: t(noticeKey), ok: notice === "shopify_connected" } : null}
      />
    </>
  );
}
