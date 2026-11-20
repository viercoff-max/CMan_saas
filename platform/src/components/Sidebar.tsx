"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
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

export function Sidebar({ tenantName, logoUrl = null, onLogout, onToggleLang, waiting = 0, role = "admin", tenants = [], activeTenantId, onSwitchTenant }: {
  tenantName: string; logoUrl?: string | null; waiting?: number; onLogout: () => Promise<void>; onToggleLang: () => Promise<void>;
  role?: Role; tenants?: TenantMembership[]; activeTenantId?: string; onSwitchTenant?: (form: FormData) => Promise<void>;
}) {
  const t = useT(shellDict);
  const path = usePathname();
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
  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-line bg-menu-bg text-menu-ink md:min-h-screen md:w-60 md:border-b-0 md:border-r">
      <div className="flex items-center justify-between gap-2 px-5 py-2 md:py-4">
        <span className="flex min-w-0 items-center gap-3">
          <BrandMark name={tenantName} logoUrl={logoUrl} />
          <span className="truncate text-lg font-semibold tracking-tight [font-family:var(--heading-font)]">{tenantName}</span>
        </span>
        <div className="flex md:hidden">{account}</div>
      </div>
      {switcher}
      <nav aria-label={t("nav.main")} className="flex scroll-px-3 gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:overflow-visible">
        {navFor(role).map((g) => (
          <div key={g.key} className="contents md:mb-2 md:flex md:flex-col md:gap-1">
            <p className="hidden px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-menu-muted md:block">{t(g.key)}</p>
            {g.items.map((i) => {
              const active = path === i.href || path.startsWith(i.href + "/");
              return (
                <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined}
                  className={`flex min-h-11 items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-medium transition ${active ? "bg-brand text-on-brand" : "text-menu-muted hover:bg-menu-hover hover:text-menu-ink"}`}>
                  <span aria-hidden>{i.icon}</span>{t(i.key)}
                  {i.href === "/inbox" && waiting > 0 && (
                    <span className="ml-auto rounded-full bg-danger px-2 py-0.5 text-xs font-semibold text-on-danger" aria-label={t("nav.waiting", { n: waiting })}>{waiting}</span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <div className="hidden gap-2 border-t border-line p-3 text-sm md:flex">{account}</div>
    </aside>
  );
}
