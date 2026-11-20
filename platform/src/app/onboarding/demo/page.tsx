// "Crear negocio demo" (Supabase mode): a separate business filled with fake sample data, to show the product.
// Open to any signed-in user (with or without a business). See actions.ts and lib/demo/business.ts.
import Link from "next/link";
import { redirect } from "next/navigation";
import { getLocale, makeT } from "@/lib/i18n";
import { getAuthState } from "@/lib/auth";
import { authBackend } from "@/lib/auth/backend";
import { DEMO_TEMPLATE_KEYS, DEMO_TEMPLATES } from "@/lib/demo/templates";
import { AuthCard, Notice } from "../../login/AuthCard";
import { demoDict } from "./dict";
import { DemoForm } from "./DemoForm";

export const dynamic = "force-dynamic";

export default async function DemoBusinessPage() {
  if (authBackend() !== "supabase") redirect("/dashboard");
  const st = await getAuthState();
  if (st.status === "anonymous") redirect("/login?next=%2Fonboarding%2Fdemo");
  const t = makeT(demoDict, await getLocale());
  if (st.status === "no_tenant" && st.suspended) {
    return <AuthCard title={t("demo.title")}><Notice tone="error">{t("demo.err.suspended")}</Notice></AuthCard>;
  }
  const templates = DEMO_TEMPLATE_KEYS.map((k) => ({
    key: k, title: t(`demo.tpl.${k}.title`), body: t(`demo.tpl.${k}.body`), defaultName: DEMO_TEMPLATES[k].defaultName,
  }));
  const labels = Object.fromEntries(Object.keys(demoDict.es).map((k) => [k, t(k)]));
  return (
    <AuthCard wide title={t("demo.title")} subtitle={t("demo.subtitle")}>
      <DemoForm templates={templates} labels={labels} />
      <p className="mt-4 text-center text-sm">
        <Link href={st.status === "ok" ? "/dashboard" : "/onboarding"} className="inline-flex min-h-11 items-center text-muted underline underline-offset-2 hover:text-ink">{t("demo.back")}</Link>
      </p>
    </AuthCard>
  );
}
