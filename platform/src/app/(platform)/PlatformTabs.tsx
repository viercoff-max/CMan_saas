"use client";
// Console tabs. The current tab is derived from the URL (aria-current="page").
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useT } from "@/lib/i18n-client";
import { consoleDict } from "@/lib/platform/console-dict";

const TABS = [
  { href: "/platform", key: "nav.overview", exact: true },
  { href: "/platform/tenants", key: "nav.tenants" },
  { href: "/platform/compliance", key: "nav.compliance" },
  { href: "/platform/audit", key: "nav.audit" },
] as const;

export function PlatformTabs({ label }: { label: string }) {
  const t = useT(consoleDict);
  const path = usePathname() ?? "/platform";
  return (
    <nav aria-label={label} className="-mx-1 flex max-w-full gap-1 overflow-x-auto text-sm">
      {TABS.map((tab) => {
        const current = "exact" in tab ? path === tab.href : path === tab.href || path.startsWith(`${tab.href}/`);
        return (
          <Link key={tab.href} href={tab.href} aria-current={current ? "page" : undefined}
            className={`inline-flex min-h-11 shrink-0 items-center rounded-lg px-3 font-semibold ${current ? "bg-white/15 text-white" : "text-white/75 hover:bg-white/10 hover:text-white"}`}>
            {t(tab.key)}
          </Link>
        );
      })}
    </nav>
  );
}
