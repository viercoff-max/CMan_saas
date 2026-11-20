"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, ConfirmDialog, PageHeader, inputCls } from "@/components/ui";
import { useT } from "@/lib/i18n-client";
import { channelsDict } from "./dict";
import { connectChannel, connectTelegram, disconnectChannel, disconnectTelegram, reregisterTelegramWebhook, type TelegramWebhookState } from "./actions";

type Ch = "whatsapp" | "instagram" | "messenger";
/** `available` comes from src/lib/platform/channels.ts (single source of truth with the public site and billing). */
export interface AccountView { channel: Ch; status: "connected" | "disconnected" | "error"; name: string; available: boolean }

/**
 * WhatsApp (beta). Manual mode = the business's OWN Meta app (App Secret + per-tenant webhook URL and verify token);
 * platform mode = the platform's Meta app, only when `platformReady`. `webhookUrl`/`verifyToken` reach admins only.
 */
export interface WhatsAppView {
  enabled: boolean; platformReady?: boolean; status: "connected" | "disconnected" | "error"; name: string; canEdit: boolean;
  mode?: "own_app" | "platform" | "none"; webhook?: "ok" | "pending"; webhookUrl?: string; verifyToken?: string; supportEmail?: string;
}

export interface TelegramView {
  status: "connected" | "disconnected" | "error"; username: string; connectedAt: string;
  webhook: TelegramWebhookState; tokenHint: string; reachable: boolean; canEdit: boolean;
}

/**
 * MVP: Telegram is the only live channel. WhatsApp / Instagram / Messenger are shown as "Próximamente" (no forms, no
 * buttons), the same as on the public site (REVIEW-qa-2 P1-4). The platform's Meta webhook settings (verify token)
 * are platform config and are never shown to tenants (REVIEW-security-2 L7).
 */
export function ChannelsClient({ telegram, accounts, whatsapp }: { telegram: TelegramView; accounts: AccountView[]; whatsapp?: WhatsAppView }) {
  const t = useT(channelsDict);
  return (
    <div>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <TelegramCard v={telegram} />
        <section aria-labelledby="more-channels">
          <h2 id="more-channels" className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted">{t("more")}</h2>
          <div className="grid gap-4">
            {accounts.map((a) => a.channel === "whatsapp" && whatsapp?.enabled
              ? <WhatsAppCard key={a.channel} v={whatsapp} />
              : <ChannelCard key={a.channel} a={a} />)}
          </div>
          <p className="mt-4 rounded-xl bg-canvas p-3 text-sm text-muted">{t("tech.test")}</p>
        </section>
      </div>
    </div>
  );
}

/** Collapsed "where do I find this?" steps. */
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

/** Meta channel: "Próximamente" (no form). A legacy connection made before the MVP switch can still be removed. */
function ChannelCard({ a }: { a: AccountView }) {
  const t = useT(channelsDict);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirm, setConfirm] = useState(false);
  const connected = a.status === "connected";
  function disconnect() {
    setConfirm(false);
    start(async () => { await disconnectChannel(a.channel); router.refresh(); });
  }
  return (
    <Card className={`flex flex-col ${connected || a.available ? "" : "opacity-90"}`}>
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-lg font-semibold">{t(`c.${a.channel}`)}</h3>
        {connected ? <Badge tone="good">{t("connected")}</Badge> : <Badge>{t("soon")}</Badge>}
      </div>
      <p className="mt-1 text-sm text-muted">{t(`d.${a.channel}`)}</p>
      {connected ? (
        <>
          {a.name && <p className="mt-2 text-sm">{t("connectedAs", { name: a.name })}</p>}
          <p className="mt-2 text-sm text-muted">{t("legacy")}</p>
          <div className="mt-3"><Button variant="ghost" className="min-h-[44px]" onClick={() => setConfirm(true)} disabled={pending}>{t("disconnect")}</Button></div>
          <ConfirmDialog open={confirm} title={t("confirmDisconnect")} confirmLabel={t("disconnect")} cancelLabel={t("cancel")}
            onConfirm={disconnect} onCancel={() => setConfirm(false)} />
        </>
      ) : (
        <p className="mt-3 text-sm text-ink">{t("soon.body")}</p>
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
  const [fieldError, setFieldError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const ids = { field: useId(), hint: useId(), error: useId() };
  const connected = v.status === "connected";
  const fmtDate = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  };
  // Only shown after a bot IS saved, so mentioning the re-register button is correct here.
  const webhookNote = (w: TelegramWebhookState) => (w === "ok" ? null : w === "needs_https" ? t("tg.needsHttps") : t("tg.webhookFailed"));

  function save() {
    setMsg(null); setFieldError("");
    start(async () => {
      try {
        const r = await connectTelegram({ botToken: token });
        if (r.ok) {
          setToken("");
          const saved = t("tg.saved", { name: `@${r.username}` });
          const note = webhookNote(r.webhook);
          setMsg(note ? { tone: "warn", text: `${saved} ${note}` } : { tone: "ok", text: saved });
          router.refresh();
        } else if (r.error === "invalid" || r.error === "token") setFieldError(t(`tg.err.${r.error}`)); // next to the field
        else setMsg({ tone: "bad", text: t(`tg.err.${r.error}`) });
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
          <p>{v.webhook === "needs_https" || !v.reachable ? (v.canEdit ? t("tg.needsHttps") : t("tg.needsHttpsAgent")) : (v.canEdit ? t("tg.webhookFailed") : t("tg.webhookFailedAgent"))}</p>
          {v.canEdit && <Button variant="secondary" className="mt-2 min-h-[44px]" onClick={reregister} disabled={pending}>{t("tg.reregister")}</Button>}
        </div>
      )}
      {/* No bot yet: explain the HTTPS requirement without claiming a bot exists or pointing at a missing button (P1-1). */}
      {!connected && !v.reachable && <p className="mt-3 rounded-xl bg-[var(--warn-bg,#fffbeb)] p-3 text-sm text-ink">{t("tg.needsHttpsNoBot")}</p>}

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
          <div>
            <label htmlFor={ids.field} className="mb-1 block text-sm font-medium text-ink">{connected ? t("tg.newToken") : t("tg.token")}</label>
            <input id={ids.field} required type="password" autoComplete="new-password" spellCheck={false} placeholder={t("tg.placeholder")}
              aria-invalid={fieldError ? true : undefined} aria-describedby={fieldError ? `${ids.error} ${ids.hint}` : ids.hint}
              className={`${inputCls} min-h-[44px] font-mono text-base md:text-sm ${fieldError ? "border-danger" : ""}`} value={token}
              onChange={(e) => { setToken(e.target.value); if (fieldError) setFieldError(""); }} />
            {fieldError && <p id={ids.error} role="alert" className="mt-1 text-sm text-danger">{fieldError}</p>}
            <span id={ids.hint} className="mt-1 block text-xs text-muted">{`${t("tokenWarn")} ${t("f.secretHint")}`}</span>
          </div>
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

/** Read-only value with a copy button (webhook URL, verify token). */
function CopyRow({ label, value }: { label: string; value: string }) {
  const t = useT(channelsDict);
  const [done, setDone] = useState(false);
  return (
    <div>
      <p className="mb-1 text-xs font-medium text-muted">{label}</p>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded-lg bg-surface px-3 py-2 font-mono text-xs text-ink">{value}</code>
        <Button type="button" variant="secondary" className="min-h-[44px] shrink-0"
          onClick={() => { void navigator.clipboard?.writeText(value).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }); }}>
          {done ? t("copied") : t("copy")}
        </Button>
      </div>
    </div>
  );
}

/**
 * WhatsApp Cloud API (beta). The business fills everything by hand: phone number ID, WABA ID, permanent token and
 * (own app) the App Secret. connectChannel tests them against Graph and subscribes the app before saving (encrypted).
 * Then, in own-app mode, the card shows the webhook URL + verify token to paste in the business's Meta app.
 */
function WhatsAppCard({ v }: { v: WhatsAppView }) {
  const t = useT(channelsDict);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [form, setForm] = useState({ externalId: "", wabaId: "", accessToken: "", appSecret: "" });
  const [msg, setMsg] = useState<{ tone: "ok" | "bad"; text: string } | null>(null);
  const [confirm, setConfirm] = useState(false);
  const ids = { id: useId(), waba: useId(), token: useId(), secret: useId(), hint: useId() };
  const connected = v.status === "connected";
  const needSecret = !v.platformReady;
  const ready = form.externalId.trim() && form.wabaId.trim() && form.accessToken.trim() && (!needSecret || form.appSecret.trim());

  function save() {
    setMsg(null);
    const ownApp = !!form.appSecret.trim();
    start(async () => {
      try {
        const r = await connectChannel("whatsapp", form);
        if (r.ok) {
          setForm({ externalId: "", wabaId: "", accessToken: "", appSecret: "" });
          setMsg({ tone: "ok", text: ownApp ? `${t("saved", { name: r.name })} ${t("wa.savedNext")}` : t("saved", { name: r.name }) });
          router.refresh();
        } else setMsg({ tone: "bad", text: t(`err.${r.error}`) });
      } catch { setMsg({ tone: "bad", text: t("err.network") }); }
    });
  }
  function disconnect() {
    setConfirm(false);
    start(async () => { await disconnectChannel("whatsapp"); setMsg(null); router.refresh(); });
  }
  const field = (key: keyof typeof form, id: string, label: string, help: string, secret = false) => (
    <div>
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink">{label}</label>
      <input id={id} required={key !== "appSecret" || needSecret} type={secret ? "password" : "text"} spellCheck={false}
        inputMode={key === "externalId" || key === "wabaId" ? "numeric" : undefined}
        autoComplete={secret ? "new-password" : "off"} aria-describedby={secret ? ids.hint : undefined}
        className={`${inputCls} min-h-[44px] font-mono text-base md:text-sm`} value={form[key]}
        onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))} />
      <Help text={help} />
    </div>
  );

  return (
    <Card className="flex flex-col">
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-lg font-semibold">{t("c.whatsapp")}</h3>
        <span className="flex gap-1.5">
          <Badge tone="info">{t("wa.beta")}</Badge>
          <Badge tone={connected ? "good" : v.status === "error" ? "bad" : "neutral"}>{t(v.status)}</Badge>
        </span>
      </div>
      <p className="mt-1 text-sm text-muted">{t("d.whatsapp")}</p>
      {connected && v.name && <p className="mt-3 rounded-xl bg-[var(--ok-bg,#ecfdf3)] p-3 text-sm text-ink">{t("connectedAs", { name: v.name })}</p>}

      {connected && v.mode === "own_app" && v.canEdit && v.webhookUrl && (
        <div className="mt-3 space-y-3 rounded-xl border border-line bg-canvas p-3" data-testid="wa-webhook">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-sm font-semibold text-ink">{t("wa.hook.title")}</h4>
            <Badge tone={v.webhook === "ok" ? "good" : "warn"}>{v.webhook === "ok" ? t("wa.hook.ok") : t("wa.hook.pending")}</Badge>
          </div>
          <ol className="list-decimal space-y-1 pl-5 text-sm text-ink">
            <li>{t("wa.hook.s1")}</li><li>{t("wa.hook.s2")}</li><li>{t("wa.hook.s3")}</li><li>{t("wa.hook.s4")}</li>
          </ol>
          <CopyRow label={t("wa.hook.url")} value={v.webhookUrl} />
          {v.verifyToken && <CopyRow label={t("wa.hook.token")} value={v.verifyToken} />}
        </div>
      )}

      <p className="mt-3 rounded-xl bg-canvas p-3 text-sm text-muted">{t("wa.window")}</p>
      <div role="status" aria-live="polite">
        {msg && <p className={`mt-3 rounded-xl p-3 text-sm ${msg.tone === "ok" ? "bg-[var(--ok-bg,#ecfdf3)] text-[var(--ok,#15803d)]" : "bg-[var(--bad-bg,#fef2f2)] text-danger"}`}>{msg.text}</p>}
      </div>
      {v.canEdit ? (
        <form className="mt-4 space-y-3 border-t border-line pt-4" autoComplete="off" onSubmit={(e) => { e.preventDefault(); save(); }}>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted">{connected ? t("wa.howChange") : t("wa.how")}</h4>
          <p className="text-sm text-ink">{t("wa.intro")}</p>
          <Help text={t("wa.app.help")} />
          {field("externalId", ids.id, t("f.whatsapp.id"), t("f.whatsapp.id.help"))}
          {field("wabaId", ids.waba, t("f.whatsapp.waba"), t("f.whatsapp.waba.help"))}
          {field("accessToken", ids.token, t("f.whatsapp.token"), t("f.whatsapp.token.help"), true)}
          {field("appSecret", ids.secret, needSecret ? t("f.whatsapp.secret") : t("f.whatsapp.secretOptional"), t("f.whatsapp.secret.help"), true)}
          <span id={ids.hint} className="block text-xs text-muted">{`${t("tokenWarn")} ${t("f.secretHint")}`}</span>
          <div className="flex flex-wrap items-center justify-between gap-2">
            {connected ? <Button type="button" variant="ghost" className="min-h-[44px]" onClick={() => setConfirm(true)} disabled={pending}>{t("disconnect")}</Button> : <span />}
            <Button type="submit" className="min-h-[44px]" disabled={pending || !ready}>{pending ? t("testing") : t("save")}</Button>
          </div>
        </form>
      ) : (
        <p className="mt-4 border-t border-line pt-4 text-sm text-muted">{t("wa.adminOnly")}</p>
      )}
      <p className="mt-4 rounded-xl border border-dashed border-line p-3 text-sm text-ink" data-testid="wa-support">
        {t("wa.support")}{" "}
        {v.supportEmail
          ? <a className="text-brand underline" href={`mailto:${v.supportEmail}?subject=${encodeURIComponent(t("wa.support.subject"))}`}>{v.supportEmail}</a>
          : <a className="text-brand underline" href="/billing">{t("wa.support.link")}</a>}
      </p>
      <ConfirmDialog open={confirm} title={t("wa.confirmTitle")} body={t("confirmDisconnect")} confirmLabel={t("disconnect")} cancelLabel={t("cancel")}
        onConfirm={disconnect} onCancel={() => setConfirm(false)} />
    </Card>
  );
}
