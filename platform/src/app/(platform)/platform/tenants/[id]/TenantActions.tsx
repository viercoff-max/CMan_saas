"use client";
// Business actions for the platform admin: suspend / reactivate, plan, AI cap, delete demo. Each opens a native
// <dialog> (focus trap + Esc); destructive ones ask for a reason and the typed short address.
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { inputCls } from "@/components/ui";
import { useT } from "@/lib/i18n-client";
import { consoleDict } from "@/lib/platform/console-dict";
import type { ActionResult } from "@/lib/platform/console";
import { changePlanAction, deleteDemoAction, reactivateAction, setAiCapAction, suspendAction } from "../../actions";

type Kind = "suspend" | "reactivate" | "plan" | "cap" | "delete";
interface Props {
  tenantId: string; name: string; slug: string; status: string; plan: string; cap: number; aiPct: number; demo: boolean;
  suspendReasons: readonly string[]; changeReasons: readonly string[];
}

const btn = "inline-flex min-h-11 items-center rounded-xl border px-4 text-sm font-medium";

export function TenantActions(p: Props) {
  const t = useT(consoleDict);
  const router = useRouter();
  const [open, setOpen] = useState<Kind | null>(null);
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const [plan, setPlan] = useState(p.plan);
  const [cap, setCap] = useState(String(p.cap));
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  function show(k: Kind) {
    setReason(k === "suspend" ? p.suspendReasons[0] : p.changeReasons[0]);
    setConfirm(""); setPlan(p.plan); setCap(String(p.cap)); setMsg(null); setOpen(k);
  }
  function run() {
    setMsg(null);
    start(async () => {
      let r: ActionResult;
      try {
        if (open === "suspend") r = await suspendAction({ tenantId: p.tenantId, reason, confirm });
        else if (open === "reactivate") r = await reactivateAction({ tenantId: p.tenantId });
        else if (open === "plan") r = await changePlanAction({ tenantId: p.tenantId, plan, reason });
        else if (open === "cap") r = await setAiCapAction({ tenantId: p.tenantId, cap: Number(cap.replace(/[_,.\s]/g, "")), reason });
        else r = await deleteDemoAction({ tenantId: p.tenantId, confirm });
      } catch { r = { ok: false, error: "failed" }; }
      if (r.ok) {
        setOpen(null);
        setMsg({ ok: true, text: t("act.done") });
        if (open === "delete") router.push("/platform/tenants"); else router.refresh();
      } else setMsg({ ok: false, text: t(`err.${r.error}`) });
    });
  }

  const needsConfirm = open === "suspend" || open === "delete";
  const disabled = pending || (needsConfirm && confirm.trim().toLowerCase() !== p.slug.toLowerCase());
  const title = open ? t(`act.${{ suspend: "suspendTitle", reactivate: "reactivateTitle", plan: "planTitle", cap: "capTitle", delete: "deleteTitle" }[open]}`, { name: p.name }) : "";
  const danger = open === "suspend" || open === "delete";

  return (
    <div>
      <div className="flex flex-wrap gap-2">
        {p.status !== "deleted" && <>
          <button type="button" onClick={() => show("plan")} className={`${btn} border-line bg-surface text-ink hover:bg-canvas`}>{t("act.plan")}</button>
          <button type="button" onClick={() => show("cap")} className={`${btn} border-line bg-surface text-ink hover:bg-canvas`}>{t("act.cap")}</button>
          {p.status === "suspended"
            ? <button type="button" onClick={() => show("reactivate")} className={`${btn} border-brand bg-brand text-on-brand hover:bg-brand-dark`}>{t("act.reactivate")}</button>
            : <button type="button" onClick={() => show("suspend")} className={`${btn} border-red-300 bg-surface text-danger hover:bg-red-50`}>{t("act.suspend")}</button>}
          {p.demo && <button type="button" onClick={() => show("delete")} className={`${btn} border-red-300 bg-surface text-danger hover:bg-red-50`}>{t("act.deleteDemo")}</button>}
        </>}
      </div>
      <p role="status" aria-live="polite" className={`mt-2 min-h-5 text-sm ${msg?.ok ? "text-ok" : "text-danger"}`}>{!open && msg?.text}</p>

      <dialog ref={ref} onClose={() => setOpen(null)} aria-labelledby="ta-title"
        className="m-auto w-[min(92vw,32rem)] rounded-2xl border border-line bg-surface p-6 text-ink shadow-xl backdrop:bg-black/50">
        <form onSubmit={(e) => { e.preventDefault(); if (!disabled) run(); }} className="space-y-4">
          <h2 id="ta-title" className="text-lg font-semibold">{title}</h2>
          {open === "suspend" && <p className="text-sm text-muted">{t("act.suspendBody")}</p>}
          {open === "reactivate" && <p className="text-sm text-muted">{t("act.reactivateBody")}</p>}
          {open === "delete" && <p className="text-sm text-muted">{t("act.deleteBody")}</p>}

          {open === "plan" && (
            <label className="block text-sm font-medium">{t("act.newPlan")}
              <select className={`${inputCls} mt-1`} value={plan} onChange={(e) => setPlan(e.target.value)}>
                {["free", "pro", "business"].map((x) => <option key={x} value={x}>{t(`plan.${x}`)}</option>)}
              </select>
            </label>
          )}
          {open === "cap" && (
            <label className="block text-sm font-medium">{t("act.newCap")}
              <input className={`${inputCls} mt-1 tabular-nums`} inputMode="numeric" value={cap} onChange={(e) => setCap(e.target.value)} maxLength={14} />
              <span className="mt-1 block text-xs font-normal text-muted">{t("act.capHint", { cap: p.cap.toLocaleString(), pct: p.aiPct })}</span>
            </label>
          )}
          {(open === "suspend" || open === "plan" || open === "cap") && (
            <label className="block text-sm font-medium">{t("act.reason")}
              <select className={`${inputCls} mt-1`} value={reason} onChange={(e) => setReason(e.target.value)}>
                {(open === "suspend" ? p.suspendReasons : p.changeReasons).map((x) => <option key={x} value={x}>{t(`${open === "suspend" ? "rs" : "rc"}.${x}`)}</option>)}
              </select>
            </label>
          )}
          {needsConfirm && (
            <label className="block text-sm font-medium">{t("act.confirmSlug", { slug: p.slug })}
              <input className={`${inputCls} mt-1 font-mono`} value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder={p.slug} autoComplete="off" spellCheck={false} />
            </label>
          )}
          {msg && !msg.ok && <p role="alert" className="text-sm text-danger">{msg.text}</p>}
          <div className="flex flex-wrap justify-end gap-2 pt-1">
            <button type="button" onClick={() => setOpen(null)} className={`${btn} border-line bg-surface text-ink hover:bg-canvas`}>{t("cancel")}</button>
            <button type="submit" disabled={disabled}
              className={`${btn} ${danger ? "border-danger bg-danger text-on-danger" : "border-brand bg-brand text-on-brand"} disabled:cursor-not-allowed disabled:opacity-50`}>
              {open === "suspend" ? t("act.suspendBtn") : open === "reactivate" ? t("act.reactivate") : open === "delete" ? t("act.deleteDemo") : t("act.save")}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}
