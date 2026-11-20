// Public instructions for end customers (also the "Data deletion instructions URL" to give Meta). The automated
// Meta callback itself lives at /api/webhooks/meta/data-deletion (not owned here). Marked draft like the other legal
// pages until the contact e-mail is set and a lawyer has reviewed the wording.
import type { Metadata } from "next";
import { getLocale } from "@/lib/i18n";
import { LEGAL_DRAFT } from "@/lib/platform/brand";
import { deletion, fill } from "@/lib/platform/content";
import { publicMetadata } from "@/lib/platform/seo";
import { LegalDocView } from "../_components/LegalDocView";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const d = deletion[locale];
  return publicMetadata({ title: fill(d.title, locale), description: fill(d.description, locale), draft: LEGAL_DRAFT });
}

export default async function DeletionPage() {
  const locale = await getLocale();
  return <LegalDocView doc={deletion[locale]} locale={locale} draft={LEGAL_DRAFT} />;
}
