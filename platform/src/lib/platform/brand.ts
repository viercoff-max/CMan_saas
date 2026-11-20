// Platform identity: the SaaS itself (public site + platform-admin screen), NEVER a tenant's brand.
// Change the product name, colours or contact details HERE only: every public page and /platform reads this file.
import type { Locale } from "../i18n-shared";

export const PLATFORM_BRAND = {
  /** Working name. Remove `provisional` once the final name is chosen. */
  name: "Conversa",
  provisional: true,
  provisionalLabel: { es: "nombre provisional", en: "provisional name" } satisfies Record<Locale, string>,
  colors: {
    /** Buttons and links (white text reaches AA on it). */
    primary: "#0F766E",
    primaryDark: "#0B5C56",
    /** Dark teal header / hero background (mockups 01 and 14). */
    deep: "#0E1F1D",
    deepText: "#E6F2F0",
    deepMuted: "#9CC3BD",
  },
  /**
   * Contact for privacy / data-deletion requests and the legal entity ("responsable"). Unknown today: the legal
   * pages print "por definir" while these are null. Fill them in before publishing.
   */
  privacyContactEmail: null as string | null,
  legalEntityName: null as string | null,
} as const;

/**
 * SEO switch. While false, EVERY public page sends `robots: noindex, nofollow` (see seo.ts). Flip to true only when
 * the name is final and a lawyer has approved the legal pages. The legal pages stay noindex while LEGAL_DRAFT is true.
 */
export const SITE_INDEXABLE = false;
/** The privacy notice and terms are drafts until a lawyer reviews them (shows the draft banner, forces noindex). */
export const LEGAL_DRAFT = true;

/** "Conversa (nombre provisional)" / "Conversa (provisional name)". */
export function platformDisplayName(locale: Locale): string {
  const b = PLATFORM_BRAND;
  return b.provisional ? `${b.name} (${b.provisionalLabel[locale]})` : b.name;
}
