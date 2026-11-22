"use client";
// "Personalizar": pick which metric cards to show and their order (saved per person, per business).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { useT } from "@/lib/i18n-client";
import { metricsDict } from "./metrics-dict";
import { saveDashboardCards } from "./actions";

export function Customize({ all, selected }: { all: string[]; selected: string[] }) {
  const t = useT(metricsDict);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [order, setOrder] = useState<string[]>(() => [...selected, ...all.filter((k) => !selected.includes(k))]);
  const [on, setOn] = useState<Set<string>>(() => new Set(selected));
  const [err, setErr] = useState(false);
  const [pending, start] = useTransition();

  const move = (i: number, d: -1 | 1) => setOrder((o) => {
    const j = i + d; if (j < 0 || j >= o.length) return o;
    const n = [...o]; [n[i], n[j]] = [n[j], n[i]]; return n;
  });
  const toggle = (k: string) => setOn((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  function save(cards: string[] | null) {
    setErr(false);
    start(async () => {
      try {
        const r = await saveDashboardCards({ cards });
        if (r.ok) { setOpen(false); router.refresh(); } else setErr(true);
      } catch { setErr(true); }
    });
  }

  if (!open) return <Button variant="secondary" className="min-h-[44px]" onClick={() => setOpen(true)}>{t("m.customize")}</Button>;
  return (
    <div role="dialog" aria-modal="false" aria-labelledby="cz-title" className="w-full rounded-2xl border border-line bg-surface p-4 shadow-sm" data-testid="customize-panel">
      <h3 id="cz-title" className="text-base font-semibold text-ink">{t("cz.title")}</h3>
      <p className="mb-3 text-sm text-muted">{t("cz.hint")}</p>
      <ul className="divide-y divide-line rounded-xl border border-line">
        {order.map((k, i) => (
          <li key={k} className="flex min-h-11 items-center gap-3 px-3 py-1">
            <label className="flex flex-1 cursor-pointer items-center gap-3 text-sm text-ink">
              <input type="checkbox" className="h-5 w-5 accent-brand" checked={on.has(k)} onChange={() => toggle(k)} />
              {t(`m.c.${k}`)}
            </label>
            <button type="button" className="min-h-11 min-w-11 rounded-lg text-muted hover:bg-canvas disabled:opacity-30" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`${t("cz.up")}: ${t(`m.c.${k}`)}`}>↑</button>
            <button type="button" className="min-h-11 min-w-11 rounded-lg text-muted hover:bg-canvas disabled:opacity-30" onClick={() => move(i, 1)} disabled={i === order.length - 1} aria-label={`${t("cz.down")}: ${t(`m.c.${k}`)}`}>↓</button>
          </li>
        ))}
      </ul>
      {err && <p role="alert" className="mt-2 text-sm text-danger">{t("cz.failed")}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button className="min-h-[44px]" disabled={pending} onClick={() => save(order.filter((k) => on.has(k)))}>{pending ? t("cz.saving") : t("cz.save")}</Button>
        <Button variant="ghost" className="min-h-[44px]" disabled={pending} onClick={() => save(null)}>{t("cz.reset")}</Button>
        <Button variant="ghost" className="min-h-[44px]" disabled={pending} onClick={() => setOpen(false)}>{t("cz.cancel")}</Button>
      </div>
    </div>
  );
}
