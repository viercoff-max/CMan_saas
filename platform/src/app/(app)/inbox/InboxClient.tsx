"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, PageHeader, inputCls } from "@/components/ui";
import { useT } from "@/lib/i18n-client";
import type { Channel, Conversation, ConversationEvent, ConversationNote, ConversationStatus, Message } from "@/lib/types";
import { inboxDict } from "./dict";
import { PlatformIcon, StatusBadge, relTime } from "./ui";
import { Simulator } from "./Simulator";
import { classifySendError } from "./send-errors";
import { isDemoConversation, isKnownReason, isUrgent, sortForInbox } from "./kinds";

type Item = Conversation & { preview: string; previewSender: string; urgent?: boolean; demo?: boolean };
type Member = { userId: string; name: string };
type Thread = {
  conversation: Conversation; messages: Message[]; windowExpired: boolean; demo?: boolean;
  notes?: ConversationNote[]; events?: ConversationEvent[]; team?: Member[]; me?: string;
  customer?: { id: string; name: string; tags: string[] } | null;
};
const POLL_MS = 4000;
// Live channels (src/lib/platform/channels.ts) + the simulator.
const PLATFORMS: Channel[] = ["telegram", "whatsapp", "manychat", "simulator"];
const STATUS_TABS: ConversationStatus[] = ["needs_human", "human", "pending", "waiting_customer", "bot", "resolved"];
type Assigned = "" | "mine" | "none";
const ON_BRAND = "text-[var(--on-brand,#fff)]";

export function InboxClient({ initialId, initialSimulator }: { initialId: string | null; initialSimulator: boolean }) {
  const t = useT(inboxDict);
  const [items, setItems] = useState<Item[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [urgentCount, setUrgentCount] = useState(0);
  const [platform, setPlatform] = useState<Channel | "">("");
  const [status, setStatus] = useState<ConversationStatus | "">("");
  const [q, setQ] = useState("");
  const [assigned, setAssigned] = useState<Assigned>("");
  const [team, setTeam] = useState<Member[]>([]);
  const [me, setMe] = useState("");
  const [selected, setSelected] = useState<string | null>(initialId);
  const [showSim, setShowSim] = useState(initialSimulator);
  const [thread, setThread] = useState<Thread | null>(null);
  const [missing, setMissing] = useState(false);

  const filt = useRef({ platform, status, q, assigned });
  filt.current = { platform, status, q, assigned };

  const loadList = useCallback(async () => {
    const f = filt.current;
    const p = new URLSearchParams();
    if (f.platform) p.set("channel", f.platform);
    if (f.status) p.set("status", f.status);
    if (f.assigned) p.set("assigned", f.assigned);
    if (f.q.trim()) p.set("q", f.q.trim());
    try {
      const r = await fetch(`/api/inbox/conversations?${p}`, { cache: "no-store" });
      if (!r.ok) return;
      const d = await r.json();
      setItems(d.conversations); setCounts(d.counts); setUrgentCount(Number(d.urgent) || 0); setLoaded(true);
      if (Array.isArray(d.team)) setTeam(d.team);
      if (typeof d.me === "string") setMe(d.me);
    } catch { /* offline: keep last data */ }
  }, []);
  const nameOf = (id: string | null | undefined) => (id ? team.find((m) => m.userId === id)?.name ?? "" : "");

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
  useEffect(() => { void loadList(); }, [platform, status, assigned, loadList]);
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
  const filtered = !!(platform || status || assigned || q.trim());

  // Urgent (safety / legal) first, then the rest of "needs a person", then everything else.
  const sorted = sortForInbox(items);
  const rightOpen = showSim || !!selected;
  const threadReady = thread && thread.conversation.id === selected;

  return (
    <div>
      {/* On phones an open conversation / the simulator replaces the header, banner and filters (composer in view). */}
      <div className={rightOpen ? "hidden md:block" : ""}>
      <PageHeader title={t("title")} subtitle={t("subtitle")}
        action={<Button variant="secondary" className="min-h-[44px]" onClick={() => { setSelected(null); setShowSim(true); }}>{t("try")}</Button>} />

      {waiting > 0 && (
        <div role="alert" className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border-2 border-red-400 bg-red-50 px-4 py-3 text-red-900 dark:bg-red-950/40 dark:text-red-100">
          <span className="text-base font-semibold">
            {waiting === 1 ? t("waiting.one") : t("waiting.many", { n: waiting })}
            {urgentCount > 0 && <> · <span className="inline-flex items-center gap-1 rounded-full bg-red-700 px-2 py-0.5 text-sm text-white"><span aria-hidden>⚠</span>{urgentCount === 1 ? t("waiting.urgent", { n: 1 }) : t("waiting.urgentMany", { n: urgentCount })}</span></>}
          </span>
          {status !== "needs_human" && (
            <Button variant="secondary" className="min-h-[44px]" onClick={() => { setStatus("needs_human"); setPlatform(""); setShowSim(false); setSelected(null); }}>{t("waiting.see")}</Button>
          )}
        </div>
      )}
      </div>

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
            <div className="mt-3 grid grid-cols-2 gap-2">
              <label className="block">
                <span className="sr-only">{t("platformLabel")}</span>
                <select className={`${inputCls} min-h-[44px] text-base md:text-sm`} value={platform} onChange={(e) => setPlatform(e.target.value as Channel | "")}>
                  <option value="">{t("platformLabel")}: {t("all")}</option>
                  {PLATFORMS.map((p) => <option key={p} value={p}>{t(`p.${p}`)}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="sr-only">{t("as.label")}</span>
                <select className={`${inputCls} min-h-[44px] text-base md:text-sm`} value={assigned} onChange={(e) => setAssigned(e.target.value as Assigned)} data-testid="assigned-filter">
                  <option value="">{t("as.label")}: {t("as.all")}</option>
                  <option value="mine">{t("as.mine")}</option>
                  <option value="none">{t("as.none")}</option>
                </select>
              </label>
            </div>
          </Card>
          <ul className="mt-3 space-y-2">
            {loaded && sorted.length === 0 && (
              <li>
                {filtered ? (
                  <div className="p-4 text-center">
                    <p className="text-sm text-muted">{t("empty.filtered")}</p>
                    <Button variant="ghost" className="mt-2 min-h-[44px]" onClick={() => { setStatus(""); setPlatform(""); setAssigned(""); setQ(""); }}>{t("empty.clear")}</Button>
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
              const waitingRow = c.status === "needs_human";
              const urgent = !!c.urgent;
              const unread = c.unread > 0;
              return (
                <li key={c.id}>
                  <button onClick={() => open(c.id)} aria-current={selected === c.id && !showSim ? "true" : undefined}
                    className={`flex min-h-[64px] w-full items-start gap-3 rounded-2xl border p-3 text-left transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 ${selected === c.id && !showSim ? "border-brand bg-canvas" : urgent ? "border-l-4 border-red-600 bg-red-50 dark:bg-red-950/40" : waitingRow ? "border-red-300 bg-red-50 dark:bg-red-950/30" : "border-line bg-surface"}`}>
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
                        {urgent ? <UrgentPill reason={c.escalationReason} /> : <StatusBadge status={c.status} label={t(`b.${c.status}`)} />}
                        {c.demo && <span className="text-xs text-muted">{t("demo.tag")}</span>}
                        {c.assignedTo && <span className="truncate text-xs text-muted">👤 {c.assignedTo === me ? `${nameOf(c.assignedTo)} ${t("as.me")}` : nameOf(c.assignedTo)}</span>}
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

/** Red "Urgente · seguridad / legal" pill with an icon (REVIEW-qa-2 P1-6). */
function UrgentPill({ reason }: { reason: string | null }) {
  const t = useT(inboxDict);
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-red-700 px-2.5 py-0.5 text-xs font-semibold text-white">
      <span aria-hidden>⚠</span>{t(reason === "legal" ? "urgent.legal" : "urgent.safety")}
    </span>
  );
}

type StatusAction = "take" | "pending" | "waiting" | "return" | "resolve";

function ThreadView({ thread, onBack, onChanged }: { thread: Thread; onBack: () => void; onChanged: () => void }) {
  const t = useT(inboxDict);
  const { conversation: c, messages, windowExpired } = thread;
  const notes = thread.notes ?? [];
  const events = thread.events ?? [];
  const team = thread.team ?? [];
  const me = thread.me ?? "";
  const [tab, setTab] = useState<"chat" | "notes" | "activity">("chat");
  const [text, setText] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const demo = isDemoConversation(c);
  const urgent = isUrgent(c);
  const endRef = useRef<HTMLDivElement>(null);
  const lastId = messages[messages.length - 1]?.id;
  useEffect(() => { if (tab === "chat") endRef.current?.scrollIntoView({ block: "end" }); }, [lastId, c.id, tab]);
  const nameOf = (id: string | null | undefined) => (id ? team.find((m) => m.userId === id)?.name ?? t("act.someone") : t("act.bot"));
  const post = (path: string, body: unknown) =>
    fetch(`/api/inbox/conversations/${c.id}/${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

  async function act(action: StatusAction) {
    setBusy(true); setError("");
    try { await post("status", { action }); }
    finally { setBusy(false); onChanged(); }
  }
  async function assign(userId: string | null) {
    setBusy(true); setError("");
    try { const r = await post("assign", { userId }); if (!r.ok) setError(t("as.failed")); }
    catch { setError(t("as.failed")); }
    finally { setBusy(false); onChanged(); }
  }
  async function addNote() {
    if (!note.trim() || busy) return;
    setBusy(true); setError("");
    try { const r = await post("notes", { body: note }); if (r.ok) setNote(""); else setError(t("notes.failed")); }
    catch { setError(t("notes.failed")); }
    finally { setBusy(false); onChanged(); }
  }
  async function deleteNote(id: string) {
    setBusy(true);
    try { await fetch(`/api/inbox/conversations/${c.id}/notes?note=${encodeURIComponent(id)}`, { method: "DELETE" }); }
    finally { setBusy(false); onChanged(); }
  }
  // One step: sending the first reply takes the conversation over (done by the server).
  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const r = await post("reply", { text });
      if (r.ok) {
        setText("");
        const d = await r.json().catch(() => ({}));
        if (d?.demo) setNotice(t("demo.saved"));
      }
      else {
        const d = await r.json().catch(() => ({}));
        if (d?.detail) console.warn("[inbox] send failed:", String(d.detail).slice(0, 200));
        setError(t(classifySendError(d?.detail || d?.error), { platform: t(`p.${c.channel}`) }));
      }
    } catch { setError(t("e.network", { platform: t(`p.${c.channel}`) })); }
    finally { setBusy(false); onChanged(); }
  }

  const eventText = (e: ConversationEvent) => {
    const actor = nameOf(e.actorUserId);
    const d = e.detail as Record<string, string | undefined>;
    if (e.kind === "assigned") return t("act.assigned", { actor, to: nameOf(d.to) });
    if (e.kind === "status") return t("act.status", { actor, to: d.to ? t(`b.${d.to}`) : "" });
    if (e.kind === "handoff") return t("act.handoff", { reason: isKnownReason(d.reason) ? t(`r.${d.reason}`) : String(d.reason ?? "") });
    return t(`act.${e.kind}`, { actor });
  };

  const reason = isKnownReason(c.escalationReason) ? t(`r.${c.escalationReason}`) : "";
  const tabs: { key: "chat" | "notes" | "activity"; label: string }[] = [
    { key: "chat", label: t("tab.chat") },
    { key: "notes", label: `${t("tab.notes")}${notes.length ? ` (${notes.length})` : ""}` },
    { key: "activity", label: t("tab.activity") },
  ];
  return (
    <Card className={`flex flex-col p-0 ${urgent ? "border-l-4 border-l-red-600" : ""}`}>
      <div className="flex items-center gap-3 border-b border-line p-4">
        <button className="-ml-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl px-2 text-sm text-muted hover:text-ink md:hidden" onClick={onBack} aria-label={t("back")}>←</button>
        <PlatformIcon channel={c.channel} name={t(`p.${c.channel}`)} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-semibold">{c.customerName || t("noName")}</span>
            {thread.customer && <Link href={`/customers/${thread.customer.id}`} className="text-xs text-brand underline">{t("cust.open")}</Link>}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
            {urgent ? <UrgentPill reason={c.escalationReason} /> : <StatusBadge status={c.status} label={t(`b.${c.status}`)} />}
            {demo && <span className="rounded-full border border-line px-2 py-0.5">{t("demo.tag")}</span>}
            {c.status === "needs_human" && reason && <span>{t("reason", { reason })}</span>}
            {c.status === "needs_human" && <span className="font-medium text-red-700 dark:text-red-300">{t("waitingSince", { time: relTime(c.lastMessageAt, t) })}</span>}
          </div>
        </div>
      </div>

      {/* Assignment + status (one row; selects keep it to one tap on phones). */}
      <div className="grid gap-2 border-b border-line p-3 sm:grid-cols-[1fr_1fr_auto]" data-testid="thread-controls">
        <label className="block text-xs text-muted">{t("as.to")}
          <select className={`${inputCls} mt-1 min-h-[44px] text-base md:text-sm`} value={c.assignedTo ?? ""} disabled={busy}
            onChange={(e) => void assign(e.target.value || null)}>
            <option value="">{t("as.nobody")}</option>
            {team.map((m) => <option key={m.userId} value={m.userId}>{m.name}{m.userId === me ? ` ${t("as.me")}` : ""}</option>)}
          </select>
        </label>
        <label className="block text-xs text-muted">{t("st.label")}
          <select className={`${inputCls} mt-1 min-h-[44px] text-base md:text-sm`} value="" disabled={busy}
            onChange={(e) => { const v = e.target.value as StatusAction | ""; if (v) void act(v); }}>
            <option value="">{t(`b.${c.status}`)}</option>
            {c.status !== "human" && <option value="take">{t("st.take")}</option>}
            {c.status !== "pending" && <option value="pending">{t("st.pending")}</option>}
            {c.status !== "waiting_customer" && <option value="waiting">{t("st.waiting")}</option>}
            {c.status !== "bot" && <option value="return">{t("return")}</option>}
            {c.status !== "resolved" && <option value="resolve">{t("resolve")}</option>}
          </select>
        </label>
        {c.assignedTo !== me && me && (
          <Button variant="secondary" className="min-h-[44px] self-end" onClick={() => void assign(me)} disabled={busy}>{t("as.take")}</Button>
        )}
      </div>

      <div role="tablist" aria-label={t("thread")} className="flex gap-1 border-b border-line px-3">
        {tabs.map((x) => (
          <button key={x.key} role="tab" aria-selected={tab === x.key} onClick={() => setTab(x.key)}
            className={`min-h-[44px] border-b-2 px-3 text-sm font-medium ${tab === x.key ? "border-brand text-ink" : "border-transparent text-muted hover:text-ink"}`}>{x.label}</button>
        ))}
      </div>

      {tab === "chat" && windowExpired && (
        <div key={c.id} role="alert" className="border-b border-amber-300 bg-amber-50 px-4 py-2.5 text-sm text-amber-900">
          {t("window", { platform: t(`p.${c.channel}`) })}
        </div>
      )}

      {tab === "chat" && (
        <div role="log" aria-live="polite" aria-label={t("thread")} tabIndex={0} className="max-h-[50vh] min-h-[220px] space-y-2 overflow-y-auto p-4 md:max-h-[55vh] md:min-h-[280px]">
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
      )}

      {tab === "notes" && (
        <div className="space-y-3 p-4" data-testid="notes-panel">
          <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">{t("notes.hint")}</p>
          {notes.length === 0 ? <p className="text-sm text-muted">{t("notes.empty")}</p> : (
            <ul className="space-y-2">
              {notes.map((n) => (
                <li key={n.id} className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-sm dark:border-amber-900 dark:bg-amber-950/20">
                  <div className="mb-1 flex items-center justify-between gap-2 text-xs text-muted">
                    <span>{nameOf(n.authorUserId)} · {relTime(n.createdAt, t)}</span>
                    {n.authorUserId === me && <button className="min-h-[32px] text-danger underline" onClick={() => void deleteNote(n.id)} disabled={busy}>{t("notes.delete")}</button>}
                  </div>
                  <div className="whitespace-pre-wrap break-words text-ink">{n.body}</div>
                </li>
              ))}
            </ul>
          )}
          <label className="block">
            <span className="sr-only">{t("tab.notes")}</span>
            <textarea className={`${inputCls} text-base md:text-sm`} rows={3} maxLength={4000} value={note} placeholder={t("notes.placeholder")} onChange={(e) => setNote(e.target.value)} />
          </label>
          <Button className="min-h-[44px]" onClick={() => void addNote()} disabled={busy || !note.trim()}>{t("notes.add")}</Button>
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        </div>
      )}

      {tab === "activity" && (
        <div className="p-4" data-testid="activity-panel">
          {events.length === 0 ? <p className="text-sm text-muted">{t("act.empty")}</p> : (
            <ol className="space-y-2 border-l-2 border-line pl-4">
              {[...events].reverse().map((e) => (
                <li key={e.id} className="text-sm text-ink">
                  <span className="block">{eventText(e)}</span>
                  <span className="text-xs text-muted">{new Date(e.createdAt).toLocaleString()}</span>
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {/* Sticky composer: always reachable without scrolling, also on phones (REVIEW-qa-2 P1-3). */}
      {tab === "chat" && (
        <div className="sticky bottom-0 z-10 space-y-3 rounded-b-2xl border-t border-line bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {demo && <p role="note" className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">{t("demo.note")}</p>}
          {notice && <p role="status" className="text-sm text-ok">{notice}</p>}
          {error && <p role="alert" className="text-sm text-danger">{error}</p>}
          <label className="block">
            <span className="sr-only">{t("replyLabel")}</span>
            <textarea className={`${inputCls} text-base md:text-sm`} rows={2} value={text} placeholder={t("placeholder")} onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); void send(); }
              }} />
          </label>
          <div className="flex flex-wrap items-center gap-2">
            <Button className="min-h-[44px]" onClick={send} disabled={busy || !text.trim()}>{t("reply")}</Button>
            {c.status !== "bot" && c.status !== "resolved" && <Button variant="ghost" className="min-h-[44px]" onClick={() => act("return")} disabled={busy}>{t("return")}</Button>}
            {c.status !== "resolved" && <Button variant="ghost" className="min-h-[44px]" onClick={() => act("resolve")} disabled={busy}>{t("resolve")}</Button>}
          </div>
          <p className="text-xs text-muted">{c.status === "resolved" ? t("replyHintResolved") : t("replyHint")}</p>
        </div>
      )}
    </Card>
  );
}
