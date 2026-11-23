"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card } from "@/components/ui";
import { useT } from "@/lib/i18n-client";
import { notificationsDict } from "./dict";
import { removeDevice, saveNotificationPrefs } from "./actions";

type Prefs = { waiting: boolean; urgent: boolean; assigned: boolean };
type Device = { id: string; name: string; since: string; endpointTail: string };
type DeviceState = "checking" | "unsupported" | "denied" | "off" | "on";

const b64ToBytes = (b64: string) => {
  const s = atob(b64.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((b64.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
};

async function registration(): Promise<ServiceWorkerRegistration> {
  return (await navigator.serviceWorker.getRegistration("/")) ?? navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

export function NotificationsClient({ prefs: initial, devices }: { prefs: Prefs; devices: Device[] }) {
  const t = useT(notificationsDict);
  const router = useRouter();
  const [state, setState] = useState<DeviceState>("checking");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [prefs, setPrefs] = useState(initial);
  const [prefsMsg, setPrefsMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, start] = useTransition();

  useEffect(() => {
    void (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) { setState("unsupported"); return; }
      if (Notification.permission === "denied") { setState("denied"); return; }
      try {
        const reg = await registration();
        setState((await reg.pushManager.getSubscription()) ? "on" : "off");
      } catch { setState("off"); }
    })();
  }, []);

  async function enable() {
    setBusy(true); setMsg(null);
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { setState(perm === "denied" ? "denied" : "off"); return; }
      const reg = await registration();
      const { publicKey } = await (await fetch("/api/push/subscribe", { cache: "no-store" })).json();
      const sub = (await reg.pushManager.getSubscription()) ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(publicKey) });
      const r = await fetch("/api/push/subscribe", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
      if (!r.ok) { setMsg({ ok: false, text: t("device.failed") }); return; }
      setState("on"); router.refresh();
    } catch { setMsg({ ok: false, text: t("device.failed") }); }
    finally { setBusy(false); }
  }
  async function disable() {
    setBusy(true); setMsg(null);
    try {
      const reg = await registration();
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await fetch("/api/push/subscribe", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ endpoint: sub.endpoint }) });
        await sub.unsubscribe();
      }
      setState("off"); router.refresh();
    } catch { setMsg({ ok: false, text: t("device.failed") }); }
    finally { setBusy(false); }
  }
  async function test() {
    setBusy(true); setMsg(null);
    try {
      const j = await (await fetch("/api/push/test", { method: "POST" })).json();
      setMsg(j.sent > 0 ? { ok: true, text: t("device.testSent", { n: j.sent }) } : { ok: false, text: t("device.testNone") });
    } catch { setMsg({ ok: false, text: t("device.failed") }); }
    finally { setBusy(false); }
  }
  function savePrefs() {
    setPrefsMsg("");
    start(async () => { const r = await saveNotificationPrefs(prefs); setPrefsMsg(r.ok ? t("kinds.saved") : t("kinds.failed")); });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">{t("device.title")}</h2>
          {state === "on" && <Badge tone="good">✓</Badge>}
        </div>
        <p className="mb-3 text-sm text-muted" role="status" aria-live="polite">
          {state === "on" ? t("device.on") : state === "denied" ? t("device.denied") : state === "unsupported" ? t("device.unsupported") : state === "off" ? t("device.off") : t("device.working")}
        </p>
        <div className="flex flex-wrap gap-2">
          {state === "off" && <Button className="min-h-[44px]" onClick={() => void enable()} disabled={busy}>{busy ? t("device.working") : t("device.enable")}</Button>}
          {state === "on" && <>
            <Button className="min-h-[44px]" onClick={() => void test()} disabled={busy}>{t("device.test")}</Button>
            <Button variant="ghost" className="min-h-[44px]" onClick={() => void disable()} disabled={busy}>{t("device.disable")}</Button>
          </>}
        </div>
        {msg && <p className={`mt-3 text-sm ${msg.ok ? "text-ok" : "text-danger"}`} role="status">{msg.text}</p>}
        <p className="mt-4 rounded-xl bg-canvas p-3 text-xs text-muted">{t("privacy")}</p>
      </Card>

      <Card>
        <h2 className="text-base font-semibold text-ink">{t("kinds.title")}</h2>
        <p className="mb-3 text-sm text-muted">{t("kinds.hint")}</p>
        <div className="space-y-1">
          {(["urgent", "waiting", "assigned"] as const).map((k) => (
            <label key={k} className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-ink">
              <input type="checkbox" className="h-5 w-5 accent-brand" checked={prefs[k]} onChange={(e) => setPrefs((p) => ({ ...p, [k]: e.target.checked }))} />
              {t(`kind.${k}`)}
            </label>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button className="min-h-[44px]" onClick={savePrefs} disabled={pending}>{t("kinds.save")}</Button>
          <span className="text-sm text-muted" role="status">{prefsMsg}</span>
        </div>
        <p className="mt-4 text-xs text-muted">{t("email.soon")}</p>
      </Card>

      <Card>
        <h2 className="mb-2 text-base font-semibold text-ink">{t("devices.title")}</h2>
        {devices.length === 0 ? <p className="text-sm text-muted">{t("devices.none")}</p> : (
          <ul className="divide-y divide-line">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="text-ink">{d.name} <span className="text-xs text-muted">· {new Date(d.since).toLocaleDateString()}</span></span>
                <Button variant="ghost" className="min-h-11 text-danger" onClick={() => start(async () => { await removeDevice({ id: d.id }); router.refresh(); })}>{t("devices.remove")}</Button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <h2 className="mb-2 text-base font-semibold text-ink">{t("install.title")}</h2>
        <ul className="space-y-2 text-sm text-ink">
          <li>📱 {t("install.android")}</li><li>🍎 {t("install.iphone")}</li><li>💻 {t("install.desktop")}</li>
        </ul>
      </Card>
    </div>
  );
}
