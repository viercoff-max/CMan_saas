// Customer record: profile (editable by any team member), the full log of every conversation, and merge (admins).
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card } from "@/components/ui";
import { requireMemberPage } from "@/components/guards";
import { hasRole } from "@/lib/auth";
import { getLocale, makeT } from "@/lib/i18n";
import { getData } from "@/lib/data";
import { PlatformIcon } from "../../inbox/ui";
import { customersDict } from "../dict";
import { CustomerForm, MergeForm } from "./CustomerForms";

export const dynamic = "force-dynamic";
const MSG_LIMIT = 300;

export default async function CustomerPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await requireMemberPage();
  const { id } = await params;
  const locale = await getLocale();
  const t = makeT(customersDict, locale);
  const data = getData();
  const customer = await data.customers.get(s.tenantId, id);
  if (!customer) notFound(); // also for another tenant's id
  const convs = await data.conversations.list(s.tenantId, { customerId: id, limit: 100 });
  const logs = await Promise.all(convs.map(async (c) => ({ c, messages: await data.messages.list(s.tenantId, c.id, MSG_LIMIT) })));
  const isAdmin = hasRole(s.role, "admin");
  const others = isAdmin ? (await data.customers.list(s.tenantId, { limit: 300 })).filter((x) => x.id !== id) : [];
  const fmt = (iso: string) => new Date(iso).toLocaleString(locale === "en" ? "en-US" : "es-MX", { dateStyle: "medium", timeStyle: "short" });

  return (
    <>
      <Link href="/customers" className="mb-3 inline-flex min-h-11 items-center text-sm text-muted hover:text-ink">{t("back")}</Link>
      <h1 className="mb-4 text-2xl font-semibold tracking-tight text-ink [font-family:var(--heading-font)]">{customer.name || t("noName")}</h1>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
        <div className="space-y-4">
          <Card>
            <h2 className="mb-3 text-base font-semibold text-ink">{t("profile")}</h2>
            <CustomerForm initial={{ id: customer.id, name: customer.name, email: customer.email ?? "", phone: customer.phone ?? "", tags: customer.tags.join(", "), notes: customer.notes }} />
          </Card>
          <Card>
            <h2 className="mb-1 text-base font-semibold text-ink">{t("merge")}</h2>
            <p className="mb-3 text-sm text-muted">{t("merge.hint")}</p>
            {isAdmin ? <MergeForm into={customer.id} options={others.map((o) => ({ id: o.id, label: `${o.name || t("noName")}${o.channels.length ? ` (${o.channels.map((ch) => t(`p.${ch}`)).join(", ")})` : ""}` }))} />
              : <p className="text-sm text-muted">{t("merge.adminOnly")}</p>}
          </Card>
        </div>
        <Card>
          <h2 className="mb-3 text-base font-semibold text-ink">{t("history")}</h2>
          {logs.length === 0 ? <p className="text-sm text-muted">{t("history.empty")}</p> : (
            <div className="space-y-6" data-testid="customer-history">
              {logs.map(({ c, messages }) => (
                <section key={c.id} aria-label={`${t(`p.${c.channel}`)} ${fmt(c.createdAt)}`}>
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <PlatformIcon channel={c.channel} name={t(`p.${c.channel}`)} />
                    <span className="text-sm font-medium text-ink">{t(`p.${c.channel}`)}</span>
                    <Badge>{t(`b.${c.status}`)}</Badge>
                    <span className="text-xs text-muted">{fmt(c.createdAt)}</span>
                    <Link href={`/inbox?c=${c.id}`} className="ml-auto text-xs text-brand underline">{t("history.open")}</Link>
                  </div>
                  <ol className="space-y-1.5 border-l-2 border-line pl-3">
                    {messages.map((m) => (
                      <li key={m.id} className="text-sm">
                        <span className="text-xs text-muted">{fmt(m.createdAt)} · {t(`from.${m.sender}`)}</span>
                        <p className="whitespace-pre-wrap break-words text-ink">{m.body}</p>
                      </li>
                    ))}
                  </ol>
                  {messages.length >= MSG_LIMIT && <p className="mt-1 text-xs text-muted">{t("history.more", { n: MSG_LIMIT })}</p>}
                </section>
              ))}
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
