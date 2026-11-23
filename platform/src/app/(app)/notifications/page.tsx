// "Notificaciones": turn notices on for this device (Web Push), choose which notices, see your devices, install the app.
import { PageHeader } from "@/components/ui";
import { requireMemberPage } from "@/components/guards";
import { getData } from "@/lib/data";
import { getLocale, makeT } from "@/lib/i18n";
import { notificationsDict } from "./dict";
import { NotificationsClient } from "./NotificationsClient";

export const dynamic = "force-dynamic";

function deviceName(ua: string): string {
  const os = /iPhone|iPad/.test(ua) ? "iPhone / iPad" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS/.test(ua) ? "Mac" : "Dispositivo";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return br ? `${os} · ${br}` : os;
}

export default async function NotificationsPage() {
  const s = await requireMemberPage();
  const t = makeT(notificationsDict, await getLocale());
  const data = getData();
  const [prefs, devices] = await Promise.all([data.push.getPrefs(s.tenantId, s.userId), data.push.listDevices(s.tenantId, s.userId)]);
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <NotificationsClient prefs={prefs}
        devices={devices.map((d) => ({ id: d.id, name: deviceName(d.userAgent), since: d.createdAt, endpointTail: d.endpoint.slice(-16) }))} />
    </>
  );
}
