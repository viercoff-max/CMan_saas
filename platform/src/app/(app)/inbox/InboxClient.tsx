"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, PageHeader, inputCls } from "@/components/ui";
import { useT } from "@/lib/i18n-client";
import type { Channel, Conversation, ConversationStatus, Message } from "@/lib/types";
import { inboxDict } from "./dict";
import { PlatformIcon, StatusBadge, relTime } from "./ui";
import { Simulator } from "./Simulator";
import { classifySendError } from "./send-errors";

type Item = Conversation & { preview: string; previewSender: string };
type Thread = { conversation: Conversation; messages: Message[]; windowExpired: boolean };
const POLL_MS = 4000;
const PLATFORMS: Channel[] = ["whatsapp", "instagram", "messenger", "simulator"];
const STATUS_TABS: ConversationStatus[] = ["needs_human", "bot", "human", "resolved"];
const ON_BRAND = "text-[var(--on-brand,#fff)]";

export function InboxClient({ initialId, initialSimulator }: { initialId: string | null; initialSimulator: boolean }) {
  const t = useT(inboxDict);
  const [items, setItems] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [platform, setPlatform] = useState<Channel | "">("");
  const [status, setStatus] = useState<ConversationStatus | "">("");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(initialId);
  const [showSim, setShowSim] = useState(initialSimulator);
  const [thread, setThread] = useState<Thread | null>(null);
  const [missing, setMissing] = useState(false);

  const filt = useRef({ platform, status, q });
  filt.current = { platform, status, q };

  const loadList = useCallback(async () => {
    const f = filt.current;
    const p = new URLSearchParams();
    if (f.platform) p.set("channel", f.platform);
    if (f.status) p.set("status", f.status);
    if (f.q.trim()) p.set("q", f.q.trim());
    try {
      const r = await fetch(`/api/inbox/conversations?${p}`, { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      setItems(d.conversations); setCounts(d.counts); setLoaded(true);
    } catch { /* offline: keep last data */ }
  }, []);

  const loadThread = useCallback(async (id: string | null) => {
    if (!id) { setThread(null); return; }
    try {
      const r = await fetch(`/api/inbox/conversations/${id}/messages`, { cache: "no-store" });
      if (!r.ok) { if (r.status === 404) { setThread(null); setMissing(true); } return; }
      setMissing(false);
      setThread(await r.json());
    } catch { /* keep */ }
  }, []);

  useEffect(() => { void loadList(); const i = setInterval(loadList, POLL_MS); return () => clearInterval(i); }, [loadList]);
  useEffect(() => { void loadList(); }, [platform, status, loadList]);
  useEffect(() => {
    const d = setTimeout(() => void loadList(), 250);
    return () => clearTimeout(d);
  }, [q, loadList]);
  useEffect(() => {
    setThread(null); setMissing(false);
    void loadThread(selected);
    if (!selected) return;
    const i = setInterval(() => void loadThread(selected), POLL_MS);
    return () => clearInterval(i);
  }, [selected, loadThread]);

  const waiting = counts.needs_human ?? 0;
  // Live "waiting" count in the browser tab while this screen is open.
  useEffect(() => {
    const base = document.title.replace(/^\(\d+\)\s*/, "");
    document.title = waiting > 0 ? `(${waiting}) ${base}` : base;
    return () => { document.title = base; };
  }, [waiting]);

  const open = (id: string) => { setShowSim(false); setSelected(id); };
  const refresh = () => { void loadList(); void loadThread(selected); };
  const filtered = !!(platform || status || q.trim());

  const sorted = [...items].sort((a, b) => {
    const pa = a.status === "needs_human" ? 0 : 1, pb = b.status === "needs_human" ? 0 : 1;
    return pa - pb || b.lastMessageAt.localeCompare(a.lastMessageAt);
  });
  const rightOpen = showSim || !!selected;
  const threadReady = thread && thread.conversation.id === selected;

  return (
    <div>
      <PageHeader title={t("title")} subtitle={t("subtitle")}
        action={<Button variant="secondary" className="min-h-[44px]" onClick={() => { setSelected(null); setShowSim(true); }}>{t("try")}</Button>} />

      {waiting > 0 && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-red-400 bg-red-50 px-4 py-3 text-red-900 dark:bg-red-950/40 dark:text-red-100">
          <span className="text-base font-semibold">{waiting === 1 ? t("waiting.one") : t("waiting.many", { n: waiting })}</span>
          {status !== "needs_human" && (
            <Button variant="secondary" className="min-h-[44px]" onClick={() => { setStatus("needs_human"); setPlatform(""); setShowSim(false); setSelected(null); }}>{t("waiting.see")}</Button>
          )}
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-[340px_1fr]">
        {/* LIST */}
        <div className={`${rightOpen ? "hidden md:block" : ""} min-w-0`}>
          <Card className="p-3">
            <input className={`${inputCls} min-h-[44px] text-base md:text-sm`} placeholder={t("search")} aria-label={t("searchLabel")} value={q} onChange={(e) => setQ(e.target.value)} />
            <div className="mt-3 flex flex-wrap gap-2" role="group">
              <Chip active={status === ""} onClick={() => setStatus("")}>{t("all")}</Chip>
              {STATUS_TABS.map((s) => (
                <Chip key={s} active={status === s} onClick={() => setStatus(s)} alert={s === "needs_human"}>
                  {t(`s.${s}`)}{s === "needs_human" && waiting ? ` (${waiting})` : counts[s] && s !== "needs_human" ? ` (${counts[s]})` : ""}
                </Chip>
              ))}
            </div>
            <label className="mt-3 block">
              <span className="sr-only">{t("platformLabel")}</span>
              <select className={`${inputCls} min-h-[44px] text-base md:text-sm`} value={platform} onChange={(e) => setPlatform(e.target.value as Channel | "")}>
                <option value="">{t("platformLabel")}: {t("all")}</option>
                {PLATFORMS.map((p) => <option key={p} value={p}>{t(`p.${p}`)}</option>)}
              </select>
            </label>
          </Card>
          <ul className="mt-3 space-y-2">
            {loaded && sorted.length === 0 && (
              <li>
                {filtered ? (
                  <div className="p-4 text-center">
                    <p className="text-sm text-muted">{t("empty.filtered")}</p>
                    <Button variant="ghost" className="mt-2 min-h-[44px]" onClick={() => { setStatus(""); setPlatform(""); setQ(""); }}>{t("empty.clear")}</Button>
                  </div>
                ) : (
                  <Card className="text-center">
                    <p className="font-semibold text-ink">{t("empty.title")}</p>
                    <p className="mt-1 text-sm text-muted">{t("empty.body")}</p>
                    <div className="mt-4 flex flex-col gap-2">
                      <Button className="min-h-[44px]" onClick={() => { setSelected(null); setShowSim(true); }}>{t("empty.try")}</Button>
                      <Link href="/channels" className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-line bg-surface px-4 py-2 text-sm font-medium text-ink hover:bg-canvas">{t("empty.connect")}</Link>
                    </div>
                  </Card>
                )}
              </li>
            )}
            {sorted.map((c) => {
              const urgent = c.status === "needs_human";
              const unread = c.unread > 0;
              return (
                <li key={c.id}>
                  <button onClick={() => open(c.id)} aria-current={selected === c.id && !showSim ? "true" : undefined}
                    className={`flex min-h-[64px] w-full items-start gap-3 rounded-2xl border p-3 text-left transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${selected === c.id && !showSim ? "border-brand bg-canvas" : urgent ? "border-red-300 bg-red-50 dark:bg-red-950/30" : "border-line bg-surface"}`}>
                    <PlatformIcon channel={c.channel} name={t(`p.${c.channel}`)} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className={`truncate text-sm text-ink ${unread ? "font-bold" : "font-semibold"}`}>{c.customerName || t("noName")}</span>
                        <span className="shrink-0 text-xs text-muted">{relTime(c.lastMessageAt, t)}</span>
                      </span>
                      <span className={`mt-0.5 block truncate text-sm ${unread ? "font-medium text-ink" : "text-muted"}`}>
                        {c.previewSender === "agent" ? t("you") : c.previewSender === "bot" ? t("bot") : ""}{c.preview}
                      </span>
                      <span className="mt-1.5 flex items-center gap-2">
                        <StatusBadge status={c.status} label={t(`b.${c.status}`)} />
                        {unread && (
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-ink">
                            <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-brand" />
                            <span className="sr-only">{t("unread")}</span>
                          </span>
                        )}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* RIGHT */}
        <div className={`${rightOpen ? "" : "hidden md:block"} min-w-0`}>
          {showSim ? (
            <Simulator onClose={() => setShowSim(false)} onChanged={loadList} />
          ) : selected && threadReady ? (
            <ThreadView key={selected} thread={thread} onBack={() => setSelected(null)} onChanged={refresh} />
          ) : selected ? (
            <Card>
              <button className="mb-3 inline-flex min-h-[44px] items-center text-sm text-muted md:hidden" onClick={() => setSelected(null)}>← {t("back")}</button>
              {missing
                ? <p role="status" className="py-10 text-center text-sm text-muted">{t("missing")}</p>
                : <div role="status" aria-busy="true" className="space-y-3 py-6" aria-label={t("loading")}>
                    <div className="h-4 w-1/3 animate-pulse rounded bg-canvas" />
                    <div className="h-10 w-2/3 animate-pulse rounded-2xl bg-canvas" />
                    <div className="ml-auto h-10 w-1/2 animate-pulse rounded-2xl bg-canvas" />
                    <p className="pt-2 text-center text-sm text-muted">{t("loading")}</p>
                  </div>}
            </Card>
          ) : (
            <Card><p className="py-10 text-center text-sm text-muted">{t("pick")}</p></Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Chip({ active, onClick, children, alert }: { active: boolean; onClick: () => void; children: React.ReactNode; alert?: boolean }) {
  const base = "inline-flex min-h-[44px] items-center rounded-full border px-4 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50";
  const cls = active ? `border-brand bg-brand ${ON_BRAND}` : alert ? "border-red-300 bg-red-50 text-red-800 hover:bg-red-100" : "border-line bg-surface text-muted hover:text-ink";
  return <button type="button" aria-pressed={active} onClick={onClick} className={`${base} ${cls}`}>{children}</button>;
}

function ThreadView({ thread, onBack, onChanged }: { thread: Thread; onBack: () => void; onChanged: () => void }) {
  const t = useT(inboxDict);
  const { conversation: c, messages, windowExpired } = thread;
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);
  const lastId = messages[messages.length - 1]?.id;
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [lastId, c.id]);

  async function act(action: "return" | "resolve") {
    setBusy(true); setError("");
    try { await fetch(`/api/inbox/conversations/${c.id}/status`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) }); }
    finally { setBusy(false); onChanged(); }
  }
  // One step: sending the first reply takes the conversation over (done by the server).
  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true); setError("");
    try {
      const r = await fetch(`/api/inbox/conversations/${c.id}/reply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
      if (r.ok) setText("");
      else {
        const d = await r.json().catch(() => ({}));
        if (d?.detail) console.warn("[inbox] send failed:", String(d.detail).slice(0, 200));
        setError(t(classifySendError(d?.detail || d?.error), { platform: t(`p.${c.channel}`) }));
      }
    } catch { setError(t("e.network", { platform: t(`p.${c.channel}`) })); }
    finally { setBusy(false); onChanged(); }
  }

  const reason = c.escalationReason ? t(`r.${c.escalationReason}`) : "";
  return (
    <Card className="flex flex-col p-0">
      <div className="flex items-center gap-3 border-b border-line p-4">
        <button className="-ml-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl px-2 text-sm text-muted hover:text-ink md:hidden" onClick={onBack} aria-label={t("back")}>←</button>
        <PlatformIcon channel={c.channel} name={t(`p.${c.channel}`)} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{c.customerName || t("noName")}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
            <StatusBadge status={c.status} label={t(`b.${c.status}`)} />
            {c.status === "needs_human" && reason && <span>{t("reason", { reason })}</span>}
            {c.status === "needs_human" && <span className="font-medium text-red-700 dark:text-red-300">{t("waitingSince", { time: relTime(c.lastMessageAt, t) })}</span>}
          </div>
        </div>
      </div>

      {windowExpired && (
        <div key={c.id} role="alert" className="border-b border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          {t("window", { platform: t(`p.${c.channel}`) })}
        </div>
      )}

      <div role="log" aria-live="polite" aria-label={t("thread")} tabIndex={0} className="max-h-[55vh] min-h-[280px] space-y-2 overflow-y-auto p-4">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.sender === "customer" ? "justify-start" : "justify-end"}`}>
            <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-sm ${
              m.sender === "customer" ? "bg-canvas text-ink" : m.sender === "bot" ? "bg-blue-100 text-blue-950" : `bg-brand ${ON_BRAND}`}`}>
              <div className="mb-0.5 text-[11px] font-medium opacity-70">{t(`from.${m.sender}`)}</div>
              <div className="whitespace-pre-wrap break-words">{m.body}</div>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="space-y-3 border-t border-line p-4">
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <label className="block">
          <span className="sr-only">{t("replyLabel")}</span>
          <textarea className={`${inputCls} text-base md:text-sm`} rows={3} value={text} placeholder={t("placeholder")} onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
            }} />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Button className="min-h-[44px]" onClick={send} disabled={busy || !text.trim()}>{t("reply")}</Button>
          {c.status === "human" && <Button variant="ghost" className="min-h-[44px]" onClick={() => act("return")} disabled={busy}>{t("return")}</Button>}
          {c.status !== "resolved" && <Button variant="ghost" className="min-h-[44px]" onClick={() => act("resolve")} disabled={busy}>{t("resolve")}</Button>}
        </div>
        <p className="text-xs text-muted">{c.status === "resolved" ? t("replyHintResolved") : t("replyHint")}</p>
      </div>
    </Card>
  );
}
