// Platform identity: the SaaS itself (public site + platform-admin screen), NEVER a tenant's brand.
// Change the product name, colours or contact details HERE only: every public page and /platform reads this file.
import type { Locale } from "../i18n-shared";

export const PLATFORM_BRAND = {
  /** Final name (domain holaconversa.com). Set `provisional` back to true only if the name is reopened. */
  name: "Conversa",
  provisional: false,
  provisionalLabel: { es: "nombre provisional", en: "provisional name" } satisfies Record<Locale, string>,
  /** "hola conversa" identity (design/landing-2026). Keep in sync with :root in globals.css. */
  colors: {
    /** Buganvilia: buttons, links and the "hola" bubble (white text 5.0:1, also 4.5:1 as text on the canvas). */
    primary: "#D11C7F",
    primaryDark: "#AE1569",
    /** Tinta: dark header / hero bands. */
    deep: "#16133D",
    deepText: "#F1F0FA",
    deepMuted: "#B9B5E6",
    /** Mango: highlight stickers (with tinta text, 11:1). Jade: "resolved" states. Lila: customer bubbles. */
    mango: "#FFC53D",
    jade: "#0E9F7E",
    lila: "#D9D4FA",
    /** Cal: page background. */
    canvas: "#F4F3FB",
  },
  /**
   * OWNER-FILLABLE legal fields (REVIEW-qa-2 P1-7). While any of them is null the legal pages show a highlighted
   * "[Completar: …]" field and a "Completar antes de publicar" notice, and stay noindex. Fill them in HERE before the
   * privacy / terms / deletion URLs are given to Meta or published:
   *  - legalEntityName: razón social of the "responsable" (LFPDPPP), e.g. "Mi Empresa, S.A. de C.V."
   *  - privacyContactEmail: inbox that receives ARCO and data-deletion requests (shown as a mailto: link)
   *  - legalAddress: domicilio del responsable (LFPDPPP art. 16)
   *  - supportEmail: commercial contact (plan changes); optional, falls back to privacyContactEmail
   */
  privacyContactEmail: null as string | null,
  legalEntityName: null as string | null,
  legalAddress: null as string | null,
  supportEmail: null as string | null,
} as const;

export type LegalField = "legalEntityName" | "privacyContactEmail" | "legalAddress";
export const LEGAL_FIELDS: readonly LegalField[] = ["legalEntityName", "privacyContactEmail", "legalAddress"];
export const LEGAL_FIELD_LABEL: Record<LegalField, Record<Locale, string>> = {
  legalEntityName: { es: "razón social", en: "legal entity name" },
  privacyContactEmail: { es: "correo de contacto de privacidad", en: "privacy contact e-mail" },
  legalAddress: { es: "domicilio", en: "address" },
};
/** Legal fields still empty (the pages must not be published while this is non-empty). */
export function missingLegalFields(b: { [K in LegalField]: string | null } = PLATFORM_BRAND): LegalField[] {
  return LEGAL_FIELDS.filter((f) => !b[f]?.trim());
}
/** Commercial contact, falling back to the privacy contact. */
export const contactEmail = (): string | null => PLATFORM_BRAND.supportEmail ?? PLATFORM_BRAND.privacyContactEmail;

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
