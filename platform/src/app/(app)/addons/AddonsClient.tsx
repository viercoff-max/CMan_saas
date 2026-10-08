"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, ConfirmDialog, Field, inputCls } from "@/components/ui";
import { useLocale, useT } from "@/lib/i18n-client";
import { dict } from "./dict";

interface Props {
  connected: boolean;
  connectedAt: string | null;
  info: { name: string; shop: string; mock: boolean };
  oauth: boolean;
  channelsConnected: boolean;
  notice: { text: string; ok: boolean } | null;
}
interface OrderResult { found: boolean; statusText?: string; trackingUrl?: string; trackingNumber?: string; carrier?: string; estimatedDelivery?: string; tooOld?: boolean; mayBeOutsideWindow?: boolean; error?: string }

async function post(url: string, body?: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> {
  try {
    const r = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    return { ok: r.ok, data: await r.json().catch(() => ({})) };
  } catch { return { ok: false, data: {} }; }
}

const SHOP_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
function clientShop(v: string): string | null {
  let s = v.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/[/?#].*$/, "");
  if (s && !s.includes(".")) s += ".myshopify.com";
  return SHOP_RE.test(s) ? s : null;
}

export function AddonsClient({ connected, connectedAt, info, oauth, channelsConnected, notice }: Props) {
  const t = useT(dict);
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [shop, setShop] = useState("");
  const [token, setToken] = useState("");
  // "cc": Dev Dashboard app (Client ID + secret, current Shopify path). "token": existing admin custom app (shpat_).
  const [method, setMethod] = useState<"cc" | "token">("cc");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const errMsg = (d: Record<string, unknown>) => t(`err.${String(d.error)}` in dict.es ? `err.${String(d.error)}` : "err.generic");
  const manualReady = method === "cc" ? !!(clientId && clientSecret) : !!token;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (!clientShop(shop)) return setError(t("form.shopBad"));
    setBusy(true);
    const r = oauth
      ? await post("/api/shopify/connect", { shop })
      : await post("/api/shopify/manual", method === "cc" ? { shop, clientId, clientSecret } : { shop, token });
    if (!r.ok) { setBusy(false); return setError(errMsg(r.data)); }
    if (oauth && typeof r.data.url === "string") { window.location.href = r.data.url; return; }
    setBusy(false); setOpen(false); setToken(""); setClientSecret(""); router.refresh();
  }
  async function demo() {
    setBusy(true);
    const r = await post("/api/shopify/demo");
    setBusy(false);
    if (r.ok) { setOpen(false); router.refresh(); } else setError(t("err.generic"));
  }

  return (
    <div className="space-y-4">
      {notice && <p className={`rounded-xl px-4 py-3 text-sm ${notice.ok ? "bg-green-100 text-green-900" : "bg-red-100 text-red-900"}`} role={notice.ok ? "status" : "alert"}>{notice.text}</p>}

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">{t("shopify.name")}</h2>
            <p className="mt-1 text-sm text-muted">{t("shopify.desc")}</p>
          </div>
          <div className="flex gap-2">
            {connected && info.mock && <Badge tone="info">{t("status.demo")}</Badge>}
            <Badge tone={connected ? "good" : "neutral"}>{connected ? t("status.connected") : t("status.disconnected")}</Badge>
          </div>
        </div>

        {connected && info.mock && <p className="mt-4 rounded-xl bg-amber-100 px-4 py-3 text-sm text-amber-900" role="status">{t("demo.banner")}</p>}

        {connected ? (
          <Connected t={t} locale={locale} info={info} connectedAt={connectedAt} onDone={() => router.refresh()} />
        ) : !open ? (
          <div className="mt-5"><Button size="lg" onClick={() => setOpen(true)}>{t("shopify.connect")}</Button></div>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-4">
            <Field label={t("form.shop")} hint={t("form.shopHint")}>
              <input className={inputCls} value={shop} inputMode="url" autoCapitalize="none" onChange={(e) => setShop(e.target.value)} placeholder="mi-tienda.myshopify.com" autoFocus autoComplete="off" />
            </Field>
            {!oauth && (
              <>
                <fieldset className="space-y-2 text-sm">
                  <legend className="mb-1 font-medium text-ink">{t("method.title")}</legend>
                  {(["cc", "token"] as const).map((m) => (
                    <label key={m} className="flex min-h-[44px] cursor-pointer items-center gap-2">
                      <input type="radio" name="shopify-method" checked={method === m} onChange={() => { setMethod(m); setError(""); }} />
                      <span>{t(`method.${m}`)}</span>
                    </label>
                  ))}
                </fieldset>
                <div className="rounded-xl bg-canvas p-4 text-sm text-muted">
                  <p className="mb-2 font-medium text-ink">{t("manual.title")}</p>
                  <ol className="list-decimal space-y-1 pl-5">
                    {(method === "cc" ? ["cc.s1", "cc.s2", "cc.s3", "cc.s4", "cc.s5"] : ["manual.s1", "manual.s2", "manual.s3", "manual.s4"]).map((k) => <li key={k}>{t(k)}</li>)}
                  </ol>
                </div>
                {method === "cc" ? (
                  <>
                    <Field label={t("form.clientId")}>
                      <input className={inputCls} value={clientId} onChange={(e) => setClientId(e.target.value)} autoComplete="off" autoCapitalize="none" />
                    </Field>
                    <Field label={t("form.clientSecret")} hint={t("form.tokenHint")}>
                      <input className={inputCls} type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} autoComplete="new-password" />
                    </Field>
                  </>
                ) : (
                  <Field label={t("form.token")} hint={t("form.tokenHint")}>
                    <input className={inputCls} type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="shpat_..." autoComplete="off" />
                  </Field>
                )}
              </>
            )}
            {error && <p className="text-sm text-danger" role="alert">{error}</p>}
            <div className="flex flex-wrap items-center gap-3">
              <Button type="submit" size="lg" disabled={busy || !shop || (!oauth && !manualReady)}>{busy ? (oauth ? t("form.connecting") : t("form.verifying")) : oauth ? t("form.continue") : t("form.verify")}</Button>
              <Button type="button" variant="ghost" onClick={() => { setOpen(false); setError(""); }}>{t("form.cancel")}</Button>
            </div>
            {!channelsConnected && (
              <div className="border-t border-line pt-4">
                <Button type="button" variant="secondary" onClick={demo} disabled={busy}>{t("demo.button")}</Button>
                <p className="mt-2 text-xs text-muted">{t("demo.hint")}</p>
              </div>
            )}
          </form>
        )}
      </Card>

      <p className="px-1 text-sm text-muted">{t("twilio.soon")}</p>
    </div>
  );
}

function Connected({ t, locale, info, connectedAt, onDone }: {
  t: (k: string, v?: Record<string, string | number>) => string; locale: string;
  info: Props["info"]; connectedAt: string | null; onDone: () => void;
}) {
  const [order, setOrder] = useState("");
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<OrderResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setResult(null);
    const r = await post("/api/shopify/test", { order, email });
    setBusy(false);
    setResult(r.ok ? (r.data.result as OrderResult) : { found: false, error: String(r.data?.error ?? "generic") });
  }
  async function disconnect() {
    setConfirmOpen(false);
    await post("/api/shopify/disconnect");
    onDone();
  }
  const date = connectedAt ? new Date(connectedAt).toLocaleDateString(locale === "en" ? "en-US" : "es-MX") : "";

  const lines: string[] = [];
  if (result) {
    if (result.error) lines.push(t(`err.${result.error}` in dict.es ? `err.${result.error}` : "err.generic"));
    else if (!result.found) lines.push(result.mayBeOutsideWindow || result.tooOld ? t("test.outsidewindow") : t("test.notfound"));
    else {
      lines.push(t("test.status", { status: result.statusText ?? "" }));
      if (result.carrier) lines.push(t("test.carrier", { carrier: result.carrier }));
      if (result.trackingNumber) lines.push(t("test.tracking", { number: result.trackingNumber }));
      if (result.trackingUrl) lines.push(t("test.link", { url: result.trackingUrl }));
      if (result.estimatedDelivery) lines.push(t("test.eta", { date: result.estimatedDelivery }));
    }
  }

  return (
    <div className="mt-5 space-y-5">
      <dl className="grid gap-2 text-sm sm:grid-cols-2">
        <div><dt className="text-muted">{t("conn.store")}</dt><dd className="font-medium text-ink">{info.name || info.shop}<span className="block text-xs font-normal text-muted">{info.shop}</span></dd></div>
        {date && <div><dt className="text-muted">{t("conn.since")}</dt><dd className="font-medium text-ink">{date}</dd></div>}
      </dl>
      <p className="rounded-xl bg-canvas p-3 text-sm text-muted">{t("conn.privacy")}</p>

      <form onSubmit={run} className="space-y-3 border-t border-line pt-4">
        <h3 className="font-medium text-ink">{t("test.title")}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("test.order")}><input className={inputCls} value={order} onChange={(e) => setOrder(e.target.value)} placeholder={info.mock ? "#1001" : "#1234"} /></Field>
          <Field label={t("test.email")}><input className={inputCls} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder={info.mock ? "test@example.com" : ""} /></Field>
        </div>
        <Button type="submit" variant="secondary" disabled={busy || !order || !email}>{busy ? t("form.verifying") : t("test.run")}</Button>
        {result && (
          <div className="rounded-xl border border-line bg-canvas p-3 text-sm" role="status">
            <p className="mb-1 text-xs font-medium text-muted">{t("test.result")}</p>
            {lines.map((l, i) => <p key={i} className="text-ink break-words">{l}</p>)}
          </div>
        )}
      </form>

      <div className="border-t border-line pt-4">
        <Button variant="ghost" onClick={() => setConfirmOpen(true)} className="text-danger">{t("conn.disconnect")}</Button>
        <ConfirmDialog open={confirmOpen} title={t("conn.confirm")} confirmLabel={t("conn.confirmYes")} cancelLabel={t("conn.cancel")} onConfirm={disconnect} onCancel={() => setConfirmOpen(false)} />
      </div>
    </div>
  );
}
