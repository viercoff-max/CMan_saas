// Theme engine: WCAG math, the derived tokens (every text/background pair >= 4.5:1 in light AND dark mode for any
// brand colours), the inline style contract with globals.css, fonts and the platform default.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { BRAND_DEFAULTS } from "../../data/rules";
import {
  computeTheme, contrast, ensureContrast, fontStack, HEADING_FONT_KEYS, hoverOf, isPlatformDefault, luminance, mix, onColor,
  PLATFORM_BRAND, ratioLabel, SURFACES, themeStyle, TOKEN_NAMES, type Mode, type ThemeTokens,
} from "../theme";

// Deterministic pseudo-random colours (no flaky tests) + hand-picked hard cases.
function* colours(n: number, seed = 7): Generator<string> {
  let x = seed;
  for (let i = 0; i < n; i++) {
    x = (x * 1103515245 + 12345) % 2147483648;
    yield `#${(x % 0x1000000).toString(16).padStart(6, "0").toUpperCase()}`;
  }
}
const HARD = ["#000000", "#FFFFFF", "#808080", "#777777", "#767676", "#949494", "#FFFF00", "#00FF00", "#FF0000", "#0000FF",
  "#E9A23B", "#B42318", "#2E2B29", "#3E2A4F", "#FBF5F3", "#F6F2F8", "#0F766E", "#14181F", "#F6F7F9", "#1A1A1A", "#5D6675"];
const SAMPLE = [...HARD, ...colours(250)];

/** [foreground, background] token pairs the shell renders as text. */
function pairs(mode: Mode, t: ThemeTokens): [string, string, string][] {
  const S = SURFACES[mode];
  return [
    ["on-brand / brand", t["on-brand"], t.brand],
    ["on-brand / brand-dark (hover)", t["on-brand"], t["brand-dark"]],
    ["brand-ink / surface", t["brand-ink"], S.surface],
    ["brand-ink / canvas", t["brand-ink"], S.canvas],
    ["focus-ring / surface", t["focus-ring"], S.surface],
    ["ink / brand-soft", S.ink, t["brand-soft"]],
    ["on-brand-accent / brand-accent", t["on-brand-accent"], t["brand-accent"]],
    ["menu-ink / menu-bg", t["menu-ink"], t["menu-bg"]],
    ["menu-muted / menu-bg", t["menu-muted"], t["menu-bg"]],
    ["menu-ink / menu-hover", t["menu-ink"], t["menu-hover"]],
  ];
}

describe("WCAG math", () => {
  it("luminance and contrast match the reference values", () => {
    expect(luminance("#FFFFFF")).toBeCloseTo(1, 5);
    expect(luminance("#000000")).toBe(0);
    expect(contrast("#FFFFFF", "#000000")).toBeCloseTo(21, 5);
    expect(contrast("#777777", "#FFFFFF")).toBeCloseTo(4.48, 2); // the classic "just fails AA" grey
    expect(contrast("#767676", "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(contrast("#B42318", "#FFFFFF")).toBe(contrast("#FFFFFF", "#B42318")); // symmetric
  });
  it("mix, ensureContrast, onColor and hoverOf", () => {
    expect(mix("#000000", "#FFFFFF", 0.5)).toBe("#808080");
    expect(ensureContrast("#FFFF00", "#FFFFFF")).not.toBe("#FFFF00");
    expect(contrast(ensureContrast("#FFFF00", "#FFFFFF"), "#FFFFFF")).toBeGreaterThanOrEqual(4.5);
    expect(ensureContrast("#14181F", "#FFFFFF")).toBe("#14181F"); // already fine: unchanged
    for (const c of SAMPLE) {
      expect(contrast(onColor(c), c), c).toBeGreaterThanOrEqual(4.5);
      expect(contrast(onColor(c), hoverOf(c, onColor(c))), c).toBeGreaterThanOrEqual(contrast(onColor(c), c) - 1e-9);
    }
  });
  it("ratio labels never overstate", () => {
    expect(ratioLabel(4.4999)).toBe("4.4:1");
    expect(ratioLabel(6.66)).toBe("6.6:1");
  });
});

describe("computeTheme: every pair >= 4.5:1", () => {
  it.each(["light", "dark"] as const)("%s mode, random primary/accent/menu colours", (mode) => {
    const list = [...SAMPLE];
    for (let i = 0; i < list.length; i++) {
      const brand = { primaryColor: list[i], accentColor: list[(i * 7 + 3) % list.length], menuBgColor: list[(i * 13 + 5) % list.length] };
      const th = computeTheme(brand)[mode];
      for (const [name, fg, bg] of pairs(mode, th)) {
        expect(contrast(fg, bg), `${mode} ${name}: ${fg} on ${bg} (brand ${JSON.stringify(brand)})`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("mockup brands: Chefman red keeps white buttons; Café Aurora amber gets dark text and a darkened link colour", () => {
    const chef = computeTheme({ primaryColor: "#B42318", accentColor: "#2E2B29", menuBgColor: "#FBF5F3" });
    expect(chef.light.brand).toBe("#B42318");
    expect(chef.light["on-brand"]).toBe("#FFFFFF");
    expect(chef.report).toMatchObject({ onBrand: "light", linkAdjusted: false });
    expect(chef.report.buttonRatio).toBeGreaterThan(6.5);
    expect(chef.light["menu-bg"]).toBe("#FBF5F3");

    const aurora = computeTheme({ primaryColor: "#E9A23B", accentColor: "#3E2A4F", menuBgColor: "#F6F2F8" });
    expect(aurora.light.brand).toBe("#E9A23B"); // the button keeps the brand colour...
    expect(aurora.report.onBrand).toBe("dark"); // ...with dark text
    expect(aurora.report.linkAdjusted).toBe(true);
    expect(aurora.light["brand-ink"]).not.toBe("#E9A23B");
    expect(aurora.report.linkRatio).toBeGreaterThanOrEqual(4.5);
  });

  it("a dark menu background flips the menu text to light", () => {
    const th = computeTheme({ primaryColor: "#B42318", accentColor: "#2E2B29", menuBgColor: "#1A1A1A" });
    expect(luminance(th.light["menu-ink"])).toBeGreaterThan(0.5);
  });

  it("invalid colours fall back to the platform default instead of producing broken CSS", () => {
    const th = computeTheme({ primaryColor: "red; background:url(x)", accentColor: "#12", menuBgColor: undefined as unknown as string });
    expect(th.light.brand).toBe(PLATFORM_BRAND.primaryColor);
    for (const v of Object.values(themeStyle(th))) expect(v).not.toMatch(/url|;|</);
  });
});

describe("contract with globals.css and the data layer", () => {
  const css = readFileSync(path.resolve(__dirname, "../../../app/globals.css"), "utf8");
  it("every token has a [data-brand] mapping for light (--tb-) and dark (--tbd-)", () => {
    for (const k of TOKEN_NAMES) {
      expect(css, k).toContain(`--${k}: var(--tb-${k});`);
      expect(css, k).toContain(`--${k}: var(--tbd-${k});`);
    }
    expect(css).toContain("--heading-font: var(--tb-heading-font);");
  });
  it("themeStyle emits exactly the --tb-* / --tbd-* properties", () => {
    const st = themeStyle(computeTheme({ primaryColor: "#B42318", accentColor: "#2E2B29", menuBgColor: "#FBF5F3", headingFont: "serif" }));
    expect(Object.keys(st).sort()).toEqual(["--tb-heading-font", ...TOKEN_NAMES.flatMap((k) => [`--tb-${k}`, `--tbd-${k}`])].sort());
    expect(st["--tb-heading-font"]).toBe(fontStack("serif"));
    for (const [k, v] of Object.entries(st)) if (k !== "--tb-heading-font") expect(v, k).toMatch(/^#[0-9A-F]{6}$/);
  });
  it("platform default = BRAND_DEFAULTS of the data layer", () => {
    expect(PLATFORM_BRAND).toEqual(BRAND_DEFAULTS);
    expect(isPlatformDefault(BRAND_DEFAULTS)).toBe(true);
    expect(isPlatformDefault({ ...BRAND_DEFAULTS, primaryColor: "#0f766e" })).toBe(true); // case-insensitive
    expect(isPlatformDefault({ ...BRAND_DEFAULTS, primaryColor: "#B42318" })).toBe(false);
    expect(isPlatformDefault({ ...BRAND_DEFAULTS, headingFont: "serif" })).toBe(false);
  });
  it("fonts: a small safe list of system stacks, unknown names fall back to the system stack", () => {
    expect(HEADING_FONT_KEYS).toEqual(["system", "serif", "rounded", "humanist"]);
    for (const k of HEADING_FONT_KEYS) expect(k).toMatch(/^[A-Za-z0-9 ]{1,60}$/); // brand_settings CHECK
    expect(fontStack("Comic Sans; } body { x")).toBe(fontStack("system"));
    expect(fontStack(null)).toBe(fontStack("system"));
  });
});
