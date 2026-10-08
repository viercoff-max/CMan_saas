// Shared UI kit. Keep screens simple: one clear primary action per card ("one-button tasks").
import Link from "next/link";
import type { ButtonHTMLAttributes, ReactNode } from "react";

const cx = (...a: (string | false | undefined)[]) => a.filter(Boolean).join(" ");

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("rounded-2xl border border-line bg-surface p-5 shadow-sm", className)}>{children}</div>;
}

type BtnProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "md" | "lg" };
const btn = (variant: string, size: string) =>
  cx(
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50 disabled:cursor-not-allowed disabled:opacity-50",
    size === "lg" ? "px-5 py-3 text-base" : "px-4 py-2 text-sm",
    variant === "primary" && "bg-brand text-on-brand hover:bg-brand-dark",
    variant === "secondary" && "border border-line bg-surface text-ink hover:bg-canvas",
    variant === "ghost" && "text-muted hover:bg-canvas hover:text-ink",
    variant === "danger" && "bg-danger text-on-danger hover:opacity-90",
  );
export function Button({ variant = "primary", size = "md", className, ...p }: BtnProps) {
  return <button {...p} className={cx(btn(variant, size), className)} />;
}
export function LinkButton({ href, variant = "primary", size = "md", children }: { href: string; variant?: BtnProps["variant"]; size?: BtnProps["size"]; children: ReactNode }) {
  return <Link href={href} className={btn(variant ?? "primary", size ?? "md")}>{children}</Link>;
}

export function Badge({ tone = "neutral", children }: { tone?: "neutral" | "good" | "warn" | "bad" | "info"; children: ReactNode }) {
  const t = { neutral: "bg-canvas text-muted", good: "bg-green-100 text-green-800", warn: "bg-amber-100 text-amber-800", bad: "bg-red-100 text-red-800", info: "bg-blue-100 text-blue-800" }[tone];
  return <span className={cx("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", t)}>{children}</span>;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}
export const inputCls = "w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-base text-ink placeholder:text-muted md:text-sm focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30";

export { ConfirmDialog } from "./ConfirmDialog";
