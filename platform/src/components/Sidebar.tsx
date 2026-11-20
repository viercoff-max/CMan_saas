"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { shellDict } from "@/lib/shell-dict";
import { useT } from "@/lib/i18n-client";
import type { Role, TenantMembership } from "@/lib/auth/session";
import { navFor } from "./nav";

const smallBtn = "inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-menu-muted hover:bg-menu-hover hover:text-menu-ink";

export function BrandMark({ name, logoUrl, size = 36 }: { name: string; logoUrl: string | null; size?: number }) {
  const style = { width: size, height: size };
  // Plain <img>: logos are tenant uploads served from /api/brand-assets or the Supabase public bucket.
  // eslint-disable-next-line @next/next/no-img-element
  if (logoUrl) return <img src={logoUrl} alt="" style={style} className="shrink-0 rounded-lg bg-surface object-contain" />;
  return (
    <span aria-hidden style={style} className="flex shrink-0 items-center justify-center rounded-lg bg-brand text-base font-semibold text-on-brand">
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

/**
 * Desktop: fixed left column. Phones: a compact top bar with a "Menú" button that opens the full navigation as a
 * panel (REVIEW-qa-2 P2-29: replaces the horizontal scroll strip). Every target is at least 44px.
 */
export function Sidebar({ tenantName, logoUrl = null, onLogout, onToggleLang, waiting = 0, role = "admin", tenants = [], activeTenantId, onSwitchTenant }: {
  tenantName: string; logoUrl?: string | null; waiting?: number; onLogout: () => Promise<void>; onToggleLang: () => Promise<void>;
  role?: Role; tenants?: TenantMembership[]; activeTenantId?: string; onSwitchTenant?: (form: FormData) => Promise<void>;
}) {
  const t = useT(shellDict);
  const path = usePathname();
  const [open, setOpen] = useState(false);
  // Close the phone menu after navigating.
  const [lastPath, setLastPath] = useState(path);
  if (lastPath !== path) { setLastPath(path); setOpen(false); }
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const account = (
    <>
      <form action={onToggleLang}><button className={smallBtn}>{t("nav.lang")}</button></form>
      <form action={onLogout}><button className={smallBtn}>{t("nav.logout")}</button></form>
    </>
  );
  const switcher = tenants.length > 1 && onSwitchTenant ? (
    <form action={onSwitchTenant} className="px-5 pb-2 md:pb-3">
      <label className="block">
        <span className="sr-only">{t("nav.switch")}</span>
        <select name="tenantId" defaultValue={activeTenantId} aria-label={t("nav.switch")}
          onChange={(e) => e.currentTarget.form?.requestSubmit()}
          className="min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30">
          {tenants.map((m) => <option key={m.id} value={m.id}>{m.name} · {t(`role.${m.role}`)}</option>)}
        </select>
      </label>
      <noscript><button type="submit" className={smallBtn}>{t("nav.switchGo")}</button></noscript>
    </form>
  ) : null;
  const badge = waiting > 0 && (
    <span className="ml-auto rounded-full bg-danger px-2 py-0.5 text-xs font-semibold text-on-danger" aria-label={t("nav.waiting", { n: waiting })}>{waiting}</span>
  );
  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-line bg-menu-bg text-menu-ink md:min-h-screen md:w-60 md:border-b-0 md:border-r">
      <div className="flex items-center justify-between gap-2 px-4 py-2 md:px-5 md:py-4">
        <span className="flex min-w-0 items-center gap-3">
          <BrandMark name={tenantName} logoUrl={logoUrl} />
          <span className="truncate text-lg font-semibold tracking-tight [font-family:var(--heading-font)]">{tenantName}</span>
        </span>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls="app-nav"
          aria-label={open ? t("nav.menuClose") : t("nav.menuOpen")}
          className="inline-flex min-h-11 min-w-11 items-center gap-2 rounded-xl border border-line px-3 text-sm font-medium text-menu-ink hover:bg-menu-hover md:hidden">
          <span aria-hidden className="text-base leading-none">{open ? "✕" : "☰"}</span>
          <span>{t("nav.menu")}</span>
          {!open && waiting > 0 && <span aria-hidden className="h-2.5 w-2.5 rounded-full bg-danger" />}
        </button>
      </div>
      <div id="app-nav" className={`${open ? "flex" : "hidden"} flex-col md:flex md:flex-1`}>
        {switcher}
        <nav aria-label={t("nav.main")} className="flex flex-col gap-1 px-3 pb-3 md:flex-1">
          {navFor(role).map((g) => (
            <div key={g.key} className="mb-2 flex flex-col gap-1">
              <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-menu-muted">{t(g.key)}</p>
              {g.items.map((i) => {
                const active = path === i.href || path.startsWith(i.href + "/");
                return (
                  <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined}
                    className={`flex min-h-11 items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${active ? "bg-brand text-on-brand" : "text-menu-muted hover:bg-menu-hover hover:text-menu-ink"}`}>
                    <span aria-hidden>{i.icon}</span>{t(i.key)}
                    {i.href === "/inbox" && badge}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="flex gap-2 border-t border-line p-3 text-sm">{account}</div>
      </div>
    </aside>
  );
}
