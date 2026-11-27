// REVIEW-qa-2 P1-4 (one channel-availability source) and P1-7 (owner-fillable legal fields, "Completar antes de publicar").
import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CHANNEL_AVAILABILITY, CHANNEL_NAMES, CHAT_CHANNELS, availableChannels, channelChips, comingSoonChannels, listNames } from "../channels";
import { LEGAL_FIELDS, PLATFORM_BRAND, missingLegalFields } from "../brand";
import { deletion, fill, fillParts, landing, privacy, terms } from "../content";
import { billingDict } from "@/app/(app)/billing/dict";
import { LegalDocView } from "@/app/(marketing)/_components/LegalDocView";

describe("channel availability (single source)", () => {
  it("MVP: Telegram is live, WhatsApp is beta (own Meta app), Instagram, Messenger and e-mail are coming soon", () => {
    expect(availableChannels()).toEqual(["telegram", "whatsapp"]);
    expect(CHANNEL_AVAILABILITY.whatsapp).toBe("beta");
    expect(comingSoonChannels()).toEqual(["instagram", "messenger", "email"]);
    expect(listNames(comingSoonChannels(), "es")).toBe("Instagram, Messenger y Correo");
    expect(listNames(comingSoonChannels(), "en")).toBe("Instagram, Messenger and Email");
  });
  it("the public landing and the billing copy say the same thing", () => {
    expect(landing.es.channels).toEqual(channelChips("es"));
    for (const ch of landing.es.channels) expect(ch.state).toBe(ch.name === "Telegram" ? "Disponible" : ch.name === "WhatsApp" ? "Beta" : "Próximamente");
    // The landing lead names live channels as live and the rest as "pronto", from the same source.
    expect(landing.es.lead).toContain("en Telegram y WhatsApp (y pronto en Instagram, Messenger y correo)");
    expect(landing.en.lead).toContain("on Telegram and WhatsApp (Instagram, Messenger and email soon)");
    // Plan copy talks about chat channels (e-mail is a separate support channel).
    for (const c of CHAT_CHANNELS) if (CHANNEL_AVAILABILITY[c] === "soon") expect(billingDict.es["plan.pro.f1"]).toContain(CHANNEL_NAMES[c]);
    expect(billingDict.es["plan.pro.f1"]).toMatch(/próximamente/);
    expect(billingDict.es["plan.pro.f1"]).toContain("WhatsApp (beta)");
  });
});

describe("legal pages: owner-fillable fields from brand.ts", () => {
  const empty = { legalEntityName: null, privacyContactEmail: null, legalAddress: null };
  const full = { legalEntityName: "Ejemplo, S.A. de C.V.", privacyContactEmail: "privacidad@example.test", legalAddress: "Calle 1, CDMX" };

  it("missing fields render as clearly marked markers, never as a plausible gap", () => {
    const s = fill(privacy.es.sections[0].p[0], "es", empty);
    expect(s).toContain("[Completar: razón social]");
    expect(s).toContain("[Completar: domicilio]");
    expect(s).toContain("[Completar: correo de contacto de privacidad]");
    expect(s).not.toMatch(/por definir/);
    expect(fill(privacy.en.sections[0].p[0], "en", empty)).toContain("[Fill in: legal entity name]");
  });

  it("filled fields replace the markers; the contact becomes a mailto part", () => {
    expect(fill(privacy.es.sections[0].p[0], "es", full)).toContain("Ejemplo, S.A. de C.V.");
    const parts = fillParts("Escribe a {contact}.", "es", full);
    expect(parts).toContainEqual({ kind: "email", email: "privacidad@example.test" });
    expect(missingLegalFields(full)).toEqual([]);
    expect(missingLegalFields(empty)).toEqual([...LEGAL_FIELDS]);
  });

  it("while fields are empty every legal page shows the 'Completar antes de publicar' notice and the markers", () => {
    // The shipped config is intentionally empty until the owner fills it in.
    expect(missingLegalFields(PLATFORM_BRAND).length).toBeGreaterThan(0);
    for (const doc of [privacy.es, terms.es, deletion.es]) {
      const html = renderToStaticMarkup(createElement(LegalDocView, { doc, locale: "es", draft: true, deletion: doc === deletion.es }));
      expect(html).toContain("Completar antes de publicar");
      expect(html).toContain('data-testid="legal-missing"');
      expect(html).not.toMatch(/por definir\)/);
    }
    const del = renderToStaticMarkup(createElement(LegalDocView, { doc: deletion.es, locale: "es", draft: true, deletion: true }));
    expect(del).toContain("Pedir la eliminación por correo");
  });
});
