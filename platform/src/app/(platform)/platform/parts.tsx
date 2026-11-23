// Server-safe building blocks of the platform console (no hooks).
import type { ReactNode } from "react";
import { Card } from "@/components/ui";
import type { T } from "@/lib/platform/format";

export function Kpi({ label, value, hint, tone, children }: { label: string; value: ReactNode; hint?: string; tone?: "warn" | "bad"; children?: ReactNode }) {
  const ring = tone === "bad" ? "border-red-300" : tone === "warn" ? "border-amber-300" : undefined;
  return (
    <Card className={ring}>
      <p className={`text-xs font-semibold uppercase tracking-wide ${tone === "bad" ? "text-danger" : tone === "warn" ? "text-warn" : "text-muted"}`}>{label}</p>
      <p className="mt-2 text-3xl font-bold tabular-nums text-ink">{value}</p>
      {children}
      {hint && <p className="mt-1 text-sm text-muted">{hint}</p>}
    </Card>
  );
}

/** Single-series daily bars. Hover shows the value; the same numbers are available as a table. */
export function DayBars({ days, t, label }: { days: { day: string; count: number }[]; t: T; label: string }) {
  const max = Math.max(1, ...days.map((d) => d.count));
  const every = days.length > 14 ? 5 : 2;
  return (
    <figure className="m-0">
      <div role="img" aria-label={label} className="flex h-36 items-end gap-[2px] border-b border-line pt-2">
        {days.map((d) => (
          <div key={d.day} className="group relative flex h-full flex-1 items-end" title={t("ov.chartBar", { day: d.day, n: d.count })}>
            <div className="w-full rounded-t bg-brand transition-opacity group-hover:opacity-80" style={{ height: `${d.count ? Math.max(3, (d.count / max) * 100) : 0}%` }} />
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="mt-1 flex gap-[2px] text-[11px] text-muted">
        {days.map((d, i) => <span key={d.day} className="flex-1 text-center">{i % every === 0 || i === days.length - 1 ? Number(d.day.slice(8)) : ""}</span>)}
      </div>
      <details className="mt-2 text-sm">
        <summary className="inline-flex min-h-11 cursor-pointer items-center text-muted underline underline-offset-2 hover:text-ink">{t("ov.tableToggle")}</summary>
        <div className="max-h-56 overflow-y-auto">
          <table className="mt-1 w-full text-left text-sm">
            <thead className="text-xs uppercase text-muted"><tr><th scope="col" className="py-1">{t("ov.colDay")}</th><th scope="col" className="py-1 text-right">{t("ov.colCount")}</th></tr></thead>
            <tbody>{days.map((d) => <tr key={d.day} className="border-t border-line"><td className="py-1">{d.day}</td><td className="py-1 text-right tabular-nums">{d.count}</td></tr>)}</tbody>
          </table>
        </div>
      </details>
    </figure>
  );
}

export function UsageBar({ pct, label }: { pct: number; label: string }) {
  const color = pct >= 100 ? "bg-red-600" : pct >= 80 ? "bg-amber-500" : "bg-brand";
  return (
    <div role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label} className="mt-2 h-2 overflow-hidden rounded-full bg-canvas ring-1 ring-line">
      <div className={`h-full ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

export function Privacy({ t }: { t: T }) {
  return <p className="mt-6 text-xs text-muted">{t("privacy")}</p>;
}
