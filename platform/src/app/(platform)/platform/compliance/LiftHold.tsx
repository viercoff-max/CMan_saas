"use client";
// "Lift…" for one legal-hold case: a reason (fixed codes) is required; the lift and its audit row are atomic.
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inputCls } from "@/components/ui";
import { useT } from "@/lib/i18n-client";
import { consoleDict } from "@/lib/platform/console-dict";
import { liftHoldAction } from "../actions";

export function LiftHold({ tenantId, conversationId, label, reasons }: { tenantId: string; conversationId: string; label: string; reasons: readonly string[] }) {
  const t = useT(consoleDict);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(reasons[0]);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  function lift() {
    setErr("");
    start(async () => {
      try {
        const r = await liftHoldAction({ tenantId, conversationId, reason });
        if (r.ok) { setOpen(false); router.refresh(); } else setErr(t(`err.${r.error}`));
      } catch { setErr(t("err.failed")); }
    });
  }

  return (
    <>
      <button type="button" onClick={() => { setErr(""); setReason(reasons[0]); setOpen(true); }}
        className="inline-flex min-h-11 items-center rounded-lg px-3 text-sm font-medium text-brand hover:bg-canvas">
        {t("cp.lift")}<span className="sr-only"> {label}</span>
      </button>
      <dialog ref={ref} onClose={() => setOpen(false)} aria-labelledby={`lh-${conversationId}`}
        className="m-auto w-[min(92vw,30rem)] rounded-2xl border border-line bg-surface p-6 text-ink shadow-xl backdrop:bg-black/50">
        <form onSubmit={(e) => { e.preventDefault(); lift(); }} className="space-y-4">
          <h2 id={`lh-${conversationId}`} className="text-lg font-semibold">{t("cp.liftTitle")}</h2>
          <p className="text-sm text-muted">{label}</p>
          <p className="text-sm text-muted">{t("cp.liftBody")}</p>
          <label className="block text-sm font-medium">{t("act.reason")}
            <select className={`${inputCls} mt-1`} value={reason} onChange={(e) => setReason(e.target.value)}>
              {reasons.map((r) => <option key={r} value={r}>{t(`lr.${r}`)}</option>)}
            </select>
          </label>
          {err && <p role="alert" className="text-sm text-danger">{err}</p>}
          <div className="flex flex-wrap justify-end gap-2">
            <button type="button" onClick={() => setOpen(false)} className="inline-flex min-h-11 items-center rounded-xl border border-line bg-surface px-4 text-sm font-medium text-ink hover:bg-canvas">{t("cancel")}</button>
            <button type="submit" disabled={pending} className="inline-flex min-h-11 items-center rounded-xl bg-danger px-4 text-sm font-medium text-on-danger disabled:opacity-50">{t("cp.liftBtn")}</button>
          </div>
        </form>
      </dialog>
    </>
  );
}
