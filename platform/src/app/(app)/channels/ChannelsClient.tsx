"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Field, PageHeader, inputCls } from "@/components/ui";
import { useT } from "@/lib/i18n-client";
import { channelsDict } from "./dict";
import { connectChannel, disconnectChannel } from "./actions";

type Ch = "whatsapp" | "instagram" | "messenger";
export interface AccountView { channel: Ch; status: "connected" | "disconnected" | "error"; name: string }

export function ChannelsClient({ accounts, webhookUrl, verifyToken }: { accounts: AccountView[]; webhookUrl: string; verifyToken: string }) {
  const t = useT(channelsDict);
  return (
    <div>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="grid gap-4 md:grid-cols-3">
        {accounts.map((a) => <ChannelCard key={a.channel} a={a} />)}
      </div>

      <details className="mt-6 rounded-2xl border border-line bg-surface shadow-sm">
        <summary className="min-h-[44px] cursor-pointer select-none rounded-2xl px-5 py-3 text-base font-semibold text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50">
          {t("tech.title")}
        </summary>
        <div className="px-5 pb-5">
          <p className="text-sm text-muted">{t("tech.intro")}</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <CopyField label={t("tech.url")} value={webhookUrl} />
            <CopyField label={t("tech.token")} value={verifyToken} empty={t("tech.noToken")} />
          </div>
          <ul className="mt-4 space-y-1 text-sm text-ink">
            <li>{t("tech.1")}</li><li>{t("tech.2")}</li><li>{t("tech.3")}</li>
          </ul>
          <p className="mt-4 rounded-xl bg-canvas p-3 text-sm text-muted">{t("tech.test")}</p>
        </div>
      </details>
    </div>
  );
}

function CopyField({ label, value, empty }: { label: string; value: string; empty?: string }) {
  const t = useT(channelsDict);
  const [done, setDone] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* clipboard blocked */ }
  }
  return (
    <div>
      <span className="mb-1 block text-sm font-medium text-ink">{label}</span>
      <div className="flex gap-2">
        <input readOnly aria-label={label} className={`${inputCls} min-h-[44px] text-base md:text-sm`} value={value || empty || ""} onFocus={(e) => e.currentTarget.select()} />
        <Button variant="secondary" className="min-h-[44px]" onClick={copy} disabled={!value}>{done ? t("copied") : t("copy")}</Button>
      </div>
    </div>
  );
}

/** Collapsed "where do I find this?" steps, one per field. */
function Help({ text }: { text: string }) {
  const t = useT(channelsDict);
  return (
    <details className="mt-1.5 text-sm">
      <summary className="inline-flex min-h-[44px] cursor-pointer select-none items-center text-brand underline decoration-dotted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50">{t("help")}</summary>
      <ol className="mt-1 space-y-1 rounded-xl bg-canvas p-3 text-muted">
        {text.split("\n").map((line) => <li key={line}>{line.replace(/^\d+\.\s*/, "")}</li>)}
      </ol>
    </details>
  );
}

function ChannelCard({ a }: { a: AccountView }) {
  const t = useT(channelsDict);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [form, setForm] = useState({ externalId: "", accessToken: "", wabaId: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const connected = a.status === "connected";
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  function save() {
    setMsg(null);
    start(async () => {
      try {
        const r = await connectChannel(a.channel, a.channel === "whatsapp" ? form : { externalId: form.externalId, accessToken: form.accessToken });
        if (r.ok) {
          setForm({ externalId: "", accessToken: "", wabaId: "" }); setOpen(false);
          setMsg({ ok: true, text: t("saved", { name: r.name }) }); router.refresh();
        } else setMsg({ ok: false, text: t(`err.${r.error}`) });
      } catch { setMsg({ ok: false, text: t("err.network") }); }
    });
  }
  function disconnect() {
    if (!window.confirm(t("confirmDisconnect"))) return;
    start(async () => { await disconnectChannel(a.channel); setMsg(null); router.refresh(); });
  }

  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <h2 className="text-lg font-semibold">{t(`c.${a.channel}`)}</h2>
        <Badge tone={connected ? "good" : a.status === "error" ? "bad" : "neutral"}>{t(a.status)}</Badge>
      </div>
      <p className="mt-1 text-sm text-muted">{t(`d.${a.channel}`)}</p>
      {connected && a.name && <p className="mt-2 text-sm">{t("connectedAs", { name: a.name })}</p>}
      <div role="status" aria-live="polite">
        {msg && <p className={`mt-2 text-sm ${msg.ok ? "text-[var(--ok,#15803d)]" : "text-danger"}`}>{msg.text}</p>}
        {pending && open && <p className="mt-2 text-sm text-muted">{t("testing")}</p>}
      </div>

      {open ? (
        <form className="mt-4 space-y-4" autoComplete="off" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <div>
            <Field label={t(`f.${a.channel}.id`)}><input required inputMode="numeric" className={`${inputCls} min-h-[44px] text-base md:text-sm`} value={form.externalId} onChange={set("externalId")} /></Field>
            <Help text={t(`f.${a.channel}.id.help`)} />
          </div>
          <div>
            <Field label={t(`f.${a.channel}.token`)} hint={`${t("tokenWarn")} ${t("f.secretHint")}`}>
              <input required type="password" autoComplete="new-password" className={`${inputCls} min-h-[44px] text-base md:text-sm`} value={form.accessToken} onChange={set("accessToken")} />
            </Field>
            <Help text={t(`f.${a.channel}.token.help`)} />
          </div>
          {a.channel === "whatsapp" && (
            <div>
              <Field label={t("f.whatsapp.waba")}><input required inputMode="numeric" className={`${inputCls} min-h-[44px] text-base md:text-sm`} value={form.wabaId} onChange={set("wabaId")} /></Field>
              <Help text={t("f.whatsapp.waba.help")} />
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" className="min-h-[44px]" disabled={pending}>{pending ? t("testing") : t("save")}</Button>
            <Button type="button" variant="ghost" className="min-h-[44px]" onClick={() => setOpen(false)} disabled={pending}>{t("cancel")}</Button>
          </div>
        </form>
      ) : (
        <div className="mt-auto flex flex-wrap gap-2 pt-4">
          {connected ? (
            <>
              <Button variant="secondary" className="min-h-[44px]" onClick={() => { setMsg(null); setOpen(true); }} disabled={pending}>{t("reconnect")}</Button>
              <Button variant="ghost" className="min-h-[44px]" onClick={disconnect} disabled={pending}>{t("disconnect")}</Button>
            </>
          ) : (
            <Button className="min-h-[44px]" onClick={() => { setMsg(null); setOpen(true); }} disabled={pending}>{t("connect")}</Button>
          )}
        </div>
      )}
    </Card>
  );
}
