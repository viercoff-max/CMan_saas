"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, ConfirmDialog, Field, PageHeader, inputCls } from "@/components/ui";
import { useT } from "@/lib/i18n-client";
import { channelsDict } from "./dict";
import { connectChannel, connectTelegram, disconnectChannel, disconnectTelegram, reregisterTelegramWebhook, type TelegramWebhookState } from "./actions";

type Ch = "whatsapp" | "instagram" | "messenger";
export interface AccountView { channel: Ch; status: "connected" | "disconnected" | "error"; name: string }

export interface TelegramView {
  status: "connected" | "disconnected" | "error"; username: string; connectedAt: string;
  webhook: TelegramWebhookState; tokenHint: string; reachable: boolean; canEdit: boolean;
}

export function ChannelsClient({ telegram, accounts, webhookUrl, verifyToken }: { telegram: TelegramView; accounts: AccountView[]; webhookUrl: string; verifyToken: string }) {
  const t = useT(channelsDict);
  return (
    <div>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <TelegramCard v={telegram} />
        <section aria-labelledby="more-channels">
          <h2 id="more-channels" className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">{t("more")}</h2>
          <div className="grid gap-4">
            {accounts.map((a) => <ChannelCard key={a.channel} a={a} />)}
          </div>
        </section>
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

/** Telegram (MVP channel): paste the BotFather token, we test it (getMe) and register the webhook. */
function TelegramCard({ v }: { v: TelegramView }) {
  const t = useT(channelsDict);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [token, setToken] = useState("");
  const [msg, setMsg] = useState<{ tone: "ok" | "warn" | "bad"; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const connected = v.status === "connected";
  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  };
  const webhookNote = (w: TelegramWebhookState) => (w === "ok" ? null : w === "needs_https" ? t("tg.needsHttps") : t("tg.webhookFailed"));

  function save() {
    setMsg(null);
    start(async () => {
      try {
        const r = await connectTelegram({ botToken: token });
        if (r.ok) {
          setToken("");
          const saved = t("tg.saved", { name: `@${r.username}` });
          const note = webhookNote(r.webhook);
          setMsg(note ? { tone: "warn", text: `${saved} ${note}` } : { tone: "ok", text: saved });
          router.refresh();
        } else setMsg({ tone: "bad", text: t(`tg.err.${r.error}`) });
      } catch { setMsg({ tone: "bad", text: t("tg.err.network") }); }
    });
  }
  function reregister() {
    setMsg(null);
    start(async () => {
      try {
        const r = await reregisterTelegramWebhook();
        const note = r.ok && r.webhook ? webhookNote(r.webhook) : t("tg.webhookFailed");
        setMsg(note ? { tone: "warn", text: note } : { tone: "ok", text: t("tg.reregistered") });
        router.refresh();
      } catch { setMsg({ tone: "bad", text: t("tg.err.network") }); }
    });
  }
  function disconnect() {
    setConfirm(false);
    start(async () => { await disconnectTelegram(); setMsg(null); router.refresh(); });
  }
  const msgCls = (tone: "ok" | "warn" | "bad") =>
    tone === "ok" ? "bg-[var(--ok-bg,#ecfdf3)] text-[var(--ok,#15803d)]" : tone === "warn" ? "bg-[var(--warn-bg,#fffbeb)] text-ink" : "bg-[var(--bad-bg,#fef2f2)] text-danger";

  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{t("c.telegram")}</h2>
          <p className="mt-0.5 text-sm text-muted">{t("d.telegram")}</p>
        </div>
        <Badge tone={connected ? "good" : v.status === "error" ? "bad" : "neutral"}>{t(v.status)}</Badge>
      </div>

      {connected && v.username && (
        <p className="mt-4 rounded-xl bg-[var(--ok-bg,#ecfdf3)] p-3 text-sm text-ink">{t("connectedAs", { name: `@${v.username}` })}</p>
      )}
      {connected && v.webhook !== "ok" && (
        <div className="mt-3 rounded-xl bg-[var(--warn-bg,#fffbeb)] p-3 text-sm text-ink">
          <p>{v.webhook === "needs_https" || !v.reachable ? t("tg.needsHttps") : t("tg.webhookFailed")}</p>
          {v.canEdit && <Button variant="secondary" className="mt-2 min-h-[44px]" onClick={reregister} disabled={pending}>{t("tg.reregister")}</Button>}
        </div>
      )}
      {!connected && !v.reachable && <p className="mt-3 rounded-xl bg-[var(--warn-bg,#fffbeb)] p-3 text-sm text-ink">{t("tg.needsHttps")}</p>}

      {connected && v.username && (
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-muted">{t("tg.link")}</dt>
          <dd className="text-right font-mono">
            <a className="text-brand underline" href={`https://t.me/${encodeURIComponent(v.username)}`} target="_blank" rel="noopener noreferrer">t.me/{v.username}</a>
          </dd>
          {fmtDate(v.connectedAt) && (<><dt className="text-muted">{t("tg.connectedAt")}</dt><dd className="text-right">{fmtDate(v.connectedAt)}</dd></>)}
        </dl>
      )}

      <div role="status" aria-live="polite">
        {msg && <p className={`mt-3 rounded-xl p-3 text-sm ${msgCls(msg.tone)}`}>{msg.text}</p>}
      </div>

      {v.canEdit ? (
        <form className="mt-4 space-y-3 border-t border-line pt-4" autoComplete="off" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">{connected ? t("tg.howChange") : t("tg.how")}</h3>
          <ol className="space-y-1.5 text-sm text-ink">
            <li>{t("tg.step1")}</li><li>{t("tg.step2")}</li><li>{t("tg.step3")}</li>
          </ol>
          <Help text={t("tg.help")} />
          {connected && v.tokenHint && <p className="text-sm text-muted">{t("tg.currentToken")} <span className="font-mono">{v.tokenHint}</span></p>}
          <Field label={connected ? t("tg.newToken") : t("tg.token")} hint={`${t("tokenWarn")} ${t("f.secretHint")}`}>
            <input required type="password" autoComplete="new-password" spellCheck={false} placeholder={t("tg.placeholder")}
              className={`${inputCls} min-h-[44px] font-mono text-base md:text-sm`} value={token} onChange={(e) => setToken(e.target.value)} />
          </Field>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {connected ? <Button type="button" variant="ghost" className="min-h-[44px]" onClick={() => setConfirm(true)} disabled={pending}>{t("disconnect")}</Button> : <span />}
            <Button type="submit" className="min-h-[44px]" disabled={pending || !token.trim()}>{pending ? t("testing") : t("save")}</Button>
          </div>
        </form>
      ) : (
        <p className="mt-4 border-t border-line pt-4 text-sm text-muted">{t("tg.adminOnly")}</p>
      )}
      <ConfirmDialog open={confirm} title={t("tg.confirmTitle")} body={t("confirmDisconnect")} confirmLabel={t("disconnect")} cancelLabel={t("cancel")}
        onConfirm={disconnect} onCancel={() => setConfirm(false)} />
    </Card>
  );
}
