import type { Metadata } from "next";
import { getLocale } from "@/lib/i18n";
import { LEGAL_DRAFT } from "@/lib/platform/brand";
import { fill, privacy } from "@/lib/platform/content";
import { publicMetadata } from "@/lib/platform/seo";
import { LegalDocView } from "../_components/LegalDocView";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const d = privacy[locale];
  return publicMetadata({ title: fill(d.title, locale), description: fill(d.description, locale), draft: LEGAL_DRAFT });
}

export default async function PrivacyPage() {
  const locale = await getLocale();
  return <LegalDocView doc={privacy[locale]} locale={locale} draft={LEGAL_DRAFT} />;
}
