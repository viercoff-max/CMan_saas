"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { shellDict } from "@/lib/shell-dict";
import { useT } from "@/lib/i18n-client";

const ITEMS = [
  { href: "/dashboard", key: "nav.dashboard", icon: "🏠" },
  { href: "/context", key: "nav.context", icon: "📝" },
  { href: "/tone", key: "nav.tone", icon: "🎚️" },
  { href: "/sources", key: "nav.sources", icon: "🔗" },
  { href: "/inbox", key: "nav.inbox", icon: "💬" },
  { href: "/addons", key: "nav.addons", icon: "🧩" },
  { href: "/channels", key: "nav.channels", icon: "📡" },
];

const smallBtn = "inline-flex min-h-11 items-center rounded-lg px-3 text-sm text-muted hover:bg-canvas hover:text-ink";

export function Sidebar({ tenantName, onLogout, onToggleLang, waiting = 0 }: { tenantName: string; waiting?: number; onLogout: () => Promise<void>; onToggleLang: () => Promise<void> }) {
  const t = useT(shellDict);
  const path = usePathname();
  const account = (
    <>
      <form action={onToggleLang}><button className={smallBtn}>{t("nav.lang")}</button></form>
      <form action={onLogout}><button className={smallBtn}>{t("nav.logout")}</button></form>
    </>
  );
  return (
    <aside className="flex w-full shrink-0 flex-col border-b border-line bg-surface md:min-h-screen md:w-60 md:border-b-0 md:border-r">
      <div className="flex items-center justify-between gap-2 px-5 py-2 md:py-4">
        <span className="truncate text-lg font-semibold tracking-tight">{tenantName}</span>
        <div className="flex md:hidden">{account}</div>
      </div>
      <nav aria-label={t("nav.main")} className="flex scroll-px-3 gap-1 overflow-x-auto px-3 pb-3 md:flex-1 md:flex-col md:overflow-visible">
        {ITEMS.map((i) => {
          const active = path === i.href || path.startsWith(i.href + "/");
          return (
            <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined}
              className={`flex min-h-11 items-center gap-3 whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-medium transition ${active ? "bg-brand text-on-brand" : "text-muted hover:bg-canvas hover:text-ink"}`}>
              <span aria-hidden>{i.icon}</span>{t(i.key)}
              {i.href === "/inbox" && waiting > 0 && (
                <span className="ml-auto rounded-full bg-danger px-2 py-0.5 text-xs font-semibold text-on-danger" aria-label={t("nav.waiting", { n: waiting })}>{waiting}</span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="hidden gap-2 border-t border-line p-3 text-sm md:flex">{account}</div>
    </aside>
  );
}
