"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button, ConfirmDialog, Field, inputCls } from "@/components/ui";
import { useT } from "@/lib/i18n-client";
import { customersDict } from "../dict";
import { mergeCustomersAction, updateCustomerAction } from "../actions";

type Profile = { id: string; name: string; email: string; phone: string; tags: string; notes: string };

export function CustomerForm({ initial }: { initial: Profile }) {
  const t = useT(customersDict);
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (k: keyof Profile) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setV((x) => ({ ...x, [k]: e.target.value }));
  function save() {
    setMsg(null);
    start(async () => {
      try {
        const r = await updateCustomerAction(v);
        setMsg(r.ok ? { ok: true, text: t("saved") } : { ok: false, text: t(`err.${r.error === "not_found" ? "failed" : r.error}`) });
        if (r.ok) router.refresh();
      } catch { setMsg({ ok: false, text: t("err.failed") }); }
    });
  }
  return (
    <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <Field label={t("f.name")}><input className={inputCls} maxLength={200} value={v.name} onChange={set("name")} /></Field>
      <Field label={t("f.email")}><input className={inputCls} type="email" maxLength={320} value={v.email} onChange={set("email")} autoComplete="off" /></Field>
      <Field label={t("f.phone")}><input className={inputCls} type="tel" maxLength={40} value={v.phone} onChange={set("phone")} autoComplete="off" /></Field>
      <Field label={t("f.tags")}><input className={inputCls} maxLength={900} value={v.tags} onChange={set("tags")} /></Field>
      <Field label={t("f.notes")} hint={t("f.notesHint")}><textarea className={`${inputCls} min-h-24`} maxLength={4000} value={v.notes} onChange={set("notes")} /></Field>
      <div className="flex items-center gap-3">
        <Button type="submit" className="min-h-[44px]" disabled={pending}>{pending ? t("saving") : t("save")}</Button>
        <span role="status" aria-live="polite" className={`text-sm ${msg?.ok ? "text-ok" : "text-danger"}`}>{msg?.text}</span>
      </div>
    </form>
  );
}

export function MergeForm({ into, options }: { into: string; options: { id: string; label: string }[] }) {
  const t = useT(customersDict);
  const router = useRouter();
  const [from, setFrom] = useState("");
  const [confirm, setConfirm] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  function merge() {
    setConfirm(false); setMsg(null);
    start(async () => {
      try {
        const r = await mergeCustomersAction({ into, from });
        setMsg(r.ok ? { ok: true, text: t("merge.done") } : { ok: false, text: t("merge.failed") });
        if (r.ok) { setFrom(""); router.refresh(); }
      } catch { setMsg({ ok: false, text: t("merge.failed") }); }
    });
  }
  return (
    <div className="space-y-2">
      <label className="block text-sm text-ink">{t("merge.pick")}
        <select className={`${inputCls} mt-1 min-h-[44px]`} value={from} onChange={(e) => setFrom(e.target.value)}>
          <option value="">—</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </label>
      <Button variant="secondary" className="min-h-[44px]" disabled={!from || pending} onClick={() => setConfirm(true)}>{t("merge.btn")}</Button>
      <span role="status" aria-live="polite" className={`ml-2 text-sm ${msg?.ok ? "text-ok" : "text-danger"}`}>{msg?.text}</span>
      <ConfirmDialog open={confirm} title={t("merge")} body={t("merge.hint")} confirmLabel={t("merge.btn")} cancelLabel="Cancelar"
        onConfirm={merge} onCancel={() => setConfirm(false)} />
    </div>
  );
}
