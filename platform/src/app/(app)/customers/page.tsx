// Customers: every person who wrote to the business (one record across channels). Any team member can open it.
import Link from "next/link";
import { Card, PageHeader, inputCls } from "@/components/ui";
import { requireMemberPage } from "@/components/guards";
import { getLocale, makeT } from "@/lib/i18n";
import { getData } from "@/lib/data";
import { PlatformIcon } from "../inbox/ui";
import { customersDict } from "./dict";

export const dynamic = "force-dynamic";

export default async function CustomersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const s = await requireMemberPage();
  const locale = await getLocale();
  const t = makeT(customersDict, locale);
  const q = String((await searchParams).q ?? "").slice(0, 100).trim();
  const list = await getData().customers.list(s.tenantId, { search: q || undefined, limit: 200 });
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(locale === "en" ? "en-US" : "es-MX", { dateStyle: "medium", timeStyle: "short" }) : t("never"));
  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <form className="mb-4 flex gap-2" role="search">
        <label className="sr-only" htmlFor="cust-q">{t("search")}</label>
        <input id="cust-q" name="q" defaultValue={q} maxLength={100} placeholder={t("search")} className={`${inputCls} min-h-[44px]`} />
        <button className="min-h-[44px] shrink-0 rounded-xl border border-line bg-surface px-4 text-sm font-medium text-ink hover:bg-canvas">{t("searchBtn")}</button>
      </form>
      {list.length === 0 ? (
        <Card><p className="py-8 text-center text-sm text-muted">{q ? t("emptySearch") : t("empty")}</p></Card>
      ) : (
        <ul className="space-y-2" data-testid="customer-list">
          {list.map((c) => (
            <li key={c.id}>
              <Link href={`/customers/${c.id}`} className="flex min-h-[64px] items-center gap-3 rounded-2xl border border-line bg-surface p-3 hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/50">
                <span className="flex -space-x-2">{c.channels.slice(0, 3).map((ch) => <PlatformIcon key={ch} channel={ch} name={t(`p.${ch}`)} />)}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{c.name || t("noName")}</span>
                  <span className="block truncate text-xs text-muted">
                    {[c.email, c.phone].filter(Boolean).join(" · ") || `${t("col.conversations")}: ${c.conversations}`}
                    {c.tags.length > 0 && ` · ${c.tags.slice(0, 3).join(", ")}`}
                  </span>
                </span>
                <span className="shrink-0 text-right text-xs text-muted">
                  <span className="block">{t("col.last")}</span><span className="block">{fmt(c.lastMessageAt)}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
