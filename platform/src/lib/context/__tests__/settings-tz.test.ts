import { describe, expect, it } from "vitest";
import { TIMEZONES, tzOptions } from "../timezones";
import { defaultFallback, defaultGreeting, isLegacyDefault, storableCustomText } from "../settings";

describe("timezones", () => {
  it("every zone is a valid IANA name", () => {
    for (const z of TIMEZONES) expect(() => new Intl.DateTimeFormat("en", { timeZone: z.value })).not.toThrow();
  });
  it("includes the Mexican cities with friendly names", () => {
    const labels = TIMEZONES.map((z) => z.es).join("|");
    for (const c of ["Chihuahua", "Mazatlán", "Hermosillo", "Tijuana", "Cancún"]) expect(labels).toContain(c);
  });
  it("keeps an unknown saved zone selectable", () => {
    expect(tzOptions("Asia/Tokyo", "es")[0].value).toBe("Asia/Tokyo");
    expect(tzOptions("America/Tijuana", "es").some((o) => o.value === "Asia/Tokyo")).toBe(false);
  });
});

describe("legacy default text", () => {
  it("detects and clears old default strings, keeps custom text", () => {
    expect(isLegacyDefault(defaultGreeting("es"), "greeting")).toBe(true);
    expect(isLegacyDefault(defaultFallback("en"), "fallback")).toBe(true);
    expect(storableCustomText(defaultGreeting("en"), "greeting")).toBe("");
    expect(storableCustomText("", "fallback")).toBe("");
    expect(storableCustomText("  Hola, soy Chefi  ", "greeting")).toBe("Hola, soy Chefi");
  });
});
