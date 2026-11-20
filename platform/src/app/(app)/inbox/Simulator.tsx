"use client";
import { useEffect, useRef, useState } from "react";
import { Button, Card, inputCls } from "@/components/ui";
import { useT } from "@/lib/i18n-client";
import type { Conversation, Message } from "@/lib/types";
import { inboxDict } from "./dict";

const ON_BRAND = "text-[var(--on-brand,#fff)]";
// Starter texts are sent as the customer's message; labels are localized, texts are what a Mexican customer would write.
const STARTERS = [
  { key: "sim.s1", text: "Mi pedido #1001" },
  { key: "sim.s2", text: "Garantía" },
  { key: "sim.s3", text: "Hablar con una persona" },
  { key: "sim.s4", text: "Mi producto echó humo" },
];

export function Simulator({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const t = useT(inboxDict);
  const [messages, setMessages] = useState<Message[]>([]);
  const [conv, setConv] = useState<Conversation | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/inbox/simulate", { cache: "no-store" }).then((r) => r.json()).then((d) => {
      if (alive) { setMessages(d.messages ?? []); setConv(d.conversation ?? null); }
    }).catch(() => {});
    return () => { alive = false; };
  }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages.length, busy]);

  async function send(raw: string) {
    const body = raw.trim();
    if (!body || busy) return;
    setBusy(true); setError(""); setText("");
    // optimistic customer bubble
    setMessages((m) => [...m, { id: `tmp-${Date.now()}`, conversationId: "", tenantId: "", direction: "in", sender: "customer", body, meta: {}, createdAt: new Date().toISOString() }]);
    try {
      const r = await fetch("/api/inbox/simulate", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: body }) });
      if (!r.ok) throw new Error();
      const d = await r.json();
      setMessages(d.messages); setConv(d.conversation);
    } catch { setError(t("sim.error")); }
    finally { setBusy(false); onChanged(); }
  }
  async function reset() {
    setBusy(true);
    try { await fetch("/api/inbox/simulate", { method: "DELETE" }); setMessages([]); setConv(null); setError(""); }
    finally { setBusy(false); onChanged(); }
  }

  // After a handoff nothing answers any more: lock the input and make "Empezar de nuevo" the main action (P2-9).
  const withPerson = !!conv && (conv.status === "human" || conv.status === "needs_human");
  const locked = busy || withPerson;
  return (
    <Card className="flex w-full flex-col p-0">
      <div className="border-b border-line p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <button className="-ml-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl px-2 text-sm text-muted hover:text-ink md:hidden" onClick={onClose} aria-label={t("sim.close")}>←</button>
            <span className="font-semibold">{t("sim.title")}</span>
            <span className="rounded-full border border-amber-400 bg-amber-100 px-2.5 py-0.5 text-xs font-semibold text-amber-900">{t("sim.badge")}</span>
          </div>
          <button className="hidden min-h-[44px] px-2 text-sm text-muted hover:text-ink md:inline-block" onClick={onClose}>{t("sim.close")}</button>
        </div>
        <p className="mt-1 text-xs text-muted">{t("sim.sub")}</p>
      </div>
      <div role="log" aria-live="polite" aria-label={t("sim.log")} tabIndex={0} className="h-[45vh] min-h-[220px] space-y-2 overflow-y-auto bg-canvas p-4 md:h-[calc(100vh-24rem)] md:min-h-[300px]">
        {messages.length === 0 && <p className="py-10 text-center text-sm text-muted">{t("sim.empty")}</p>}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.sender === "customer" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2 text-sm ${
              m.sender === "customer" ? `bg-brand ${ON_BRAND}` : m.sender === "bot" ? "bg-surface text-ink shadow-sm" : "bg-blue-100 text-blue-950"}`}>
              {m.body}
            </div>
          </div>
        ))}
        {busy && <p className="text-xs text-muted" aria-hidden>…</p>}
        <div ref={endRef} />
      </div>
      {/* Sticky composer: on phones and short desktop screens the input stays in view (REVIEW-qa-2 P1-3, P2-10). */}
      <div className="sticky bottom-0 z-10 space-y-3 rounded-b-2xl border-t border-line bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        {withPerson && <p role="status" className="text-sm text-ink">{t("sim.human")}</p>}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        {!withPerson && <div>
          <p className="mb-1.5 text-xs font-medium text-muted">{t("sim.starters")}</p>
          <div className="flex flex-wrap gap-2">
            {STARTERS.map((s) => (
              <button key={s.key} type="button" disabled={locked} onClick={() => void send(s.text)}
                className="inline-flex min-h-[44px] items-center rounded-full border border-line bg-surface px-4 text-sm font-medium text-ink transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 disabled:opacity-50">
                {t(s.key)}
              </button>
            ))}
          </div>
        </div>}
        <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void send(text); }}>
          <input disabled={withPerson} className={`${inputCls} min-h-[44px] text-base disabled:opacity-60 md:text-sm`} value={text} aria-label={t("sim.label")} placeholder={t("sim.placeholder")} maxLength={2000} onChange={(e) => setText(e.target.value)} />
          <Button type="submit" className="min-h-[44px]" disabled={locked || !text.trim()}>{t("sim.send")}</Button>
        </form>
        <Button type="button" variant={withPerson ? "primary" : "ghost"} className="min-h-[44px]" onClick={reset} disabled={busy}>{t("sim.reset")}</Button>
      </div>
    </Card>
  );
}
