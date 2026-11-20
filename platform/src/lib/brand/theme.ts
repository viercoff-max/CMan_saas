// White-label theme engine (wave 2 branding). PURE and client-safe: no server imports, so the /brand live preview and
// the server-side (app) layout compute exactly the same tokens.
// From brand_settings {primaryColor, accentColor, menuBgColor, headingFont} it derives every CSS variable the shell
// uses, for light AND dark mode, with WCAG 2.x contrast math ported from design/mockups/brands.js:
//   - text on a filled colour (--on-brand, --on-brand-accent): white, near-black or black, whichever reaches 4.5:1;
//   - brand colour used as text (--brand-ink: links, focus ring): the primary darkened (light mode) or lightened
//     (dark mode) step by step until it reaches 4.5:1 on the surface AND the canvas;
//   - menu text (--menu-ink / --menu-muted) re-checked against the tenant's menu background.
// Every pair is unit-tested to be >= 4.5:1 (src/lib/brand/__tests__/theme.test.ts).
// Fonts: system stacks only. next/font/google downloads font files at BUILD time (needs network), so no web fonts.

export type Rgb = [number, number, number];
const HEX6 = /^#[0-9A-Fa-f]{6}$/;
export const isHexColor = (v: unknown): v is string => typeof v === "string" && HEX6.test(v);

export function hexToRgb(h: string): Rgb {
  let s = String(h).replace("#", "").trim();
  if (s.length === 3) s = s.split("").map((c) => c + c).join("");
  const n = parseInt(s, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgbToHex = (rgb: number[]): string =>
  "#" + rgb.map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("").toUpperCase();

/** WCAG relative luminance (0..1). */
export function luminance(h: string): number {
  const [r, g, b] = hexToRgb(h).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
/** WCAG contrast ratio (1..21). */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** a -> b by t (0..1), per channel in sRGB (like the mockups). */
export function mix(a: string, b: string, t: number): string {
  const A = hexToRgb(a), B = hexToRgb(b);
  return rgbToHex(A.map((v, i) => v + (B[i] - v) * t));
}

const WHITE = "#FFFFFF";
const BLACK = "#000000";
const NEAR_BLACK = "#16121A";

/**
 * `c` moved towards black (light backgrounds) or white (dark ones) until it reaches `ratio` against EVERY background.
 * Ends at pure black/white, which always passes against backgrounds of the same family.
 */
export function ensureContrast(c: string, bgs: string | string[], ratio = 4.5): string {
  const list = Array.isArray(bgs) ? bgs : [bgs];
  const light = list.reduce((s, b) => s + luminance(b), 0) / list.length > 0.18;
  const target = light ? BLACK : WHITE;
  for (let i = 0; i <= 50; i++) {
    const m = mix(c, target, i / 50);
    if (list.every((b) => contrast(m, b) >= ratio)) return m;
  }
  return target;
}

/** Text colour that sits ON a filled colour: white, else near-black, else black (black always reaches 4.5 when white does not). */
export function onColor(fill: string): string {
  if (contrast(WHITE, fill) >= 4.5) return WHITE;
  if (contrast(NEAR_BLACK, fill) >= 4.5) return NEAR_BLACK;
  return BLACK;
}

/** Hover/pressed shade of a fill: moved AWAY from its text colour, so text contrast only grows. */
export function hoverOf(fill: string, on: string, t = 0.12): string {
  return mix(fill, luminance(on) > 0.5 ? BLACK : WHITE, t);
}

// ---------------- fonts (safe list) ----------------
export const HEADING_FONTS = {
  system: { es: "Del sistema (recomendada)", en: "System (recommended)", stack: 'ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif' },
  serif: { es: "Clásica, con remates", en: "Classic serif", stack: 'ui-serif, "Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif' },
  rounded: { es: "Redondeada", en: "Rounded", stack: 'ui-rounded, "SF Pro Rounded", "Arial Rounded MT Bold", "Segoe UI", system-ui, sans-serif' },
  humanist: { es: "Moderna", en: "Modern", stack: 'Seravek, "Gill Sans Nova", Ubuntu, Calibri, "DejaVu Sans", sans-serif' },
} as const;
export type HeadingFont = keyof typeof HEADING_FONTS;
export const HEADING_FONT_KEYS = Object.keys(HEADING_FONTS) as HeadingFont[];
export const isHeadingFont = (v: unknown): v is HeadingFont => typeof v === "string" && Object.hasOwn(HEADING_FONTS, v);
/** Unknown / legacy names fall back to the system stack. */
export const fontStack = (key: string | null | undefined): string => HEADING_FONTS[isHeadingFont(key) ? key : "system"].stack;

// ---------------- palette ----------------
/** Platform default brand (same values as BRAND_DEFAULTS in src/lib/data/rules.ts; a test keeps them equal). */
export const PLATFORM_BRAND = { primaryColor: "#0F766E", accentColor: "#14181F", menuBgColor: "#F6F7F9", headingFont: "system" } as const;

/** Neutral surfaces of globals.css (light / dark), which tenant themes never change. */
export const SURFACES = {
  light: { surface: "#FFFFFF", canvas: "#F6F7F9", ink: "#14181F", muted: "#5D6675" },
  dark: { surface: "#161B22", canvas: "#0E1116", ink: "#EEF1F5", muted: "#9AA4B2" },
} as const;
export type Mode = keyof typeof SURFACES;

export interface BrandColors { primaryColor: string; accentColor: string; menuBgColor: string; headingFont?: string }

/** Every token the shell reads, per mode. Keys are CSS variable names without "--". */
export interface ThemeTokens {
  brand: string; "brand-dark": string; "on-brand": string; "brand-ink": string; "focus-ring": string; "brand-soft": string;
  "brand-accent": string; "on-brand-accent": string;
  "menu-bg": string; "menu-ink": string; "menu-muted": string; "menu-hover": string;
}
export const TOKEN_NAMES: (keyof ThemeTokens)[] = [
  "brand", "brand-dark", "on-brand", "brand-ink", "focus-ring", "brand-soft", "brand-accent", "on-brand-accent",
  "menu-bg", "menu-ink", "menu-muted", "menu-hover",
];

export interface ThemeReport {
  /** Text on buttons: "light" = white, "dark" = near-black/black. */
  onBrand: "light" | "dark"; buttonRatio: number;
  /** Brand colour as text on white, and whether it had to be darkened. */
  linkRatio: number; linkAdjusted: boolean;
  accentRatio: number;
  menuRatio: number;
}
export interface Theme { light: ThemeTokens; dark: ThemeTokens; font: string; report: ThemeReport }

const safeHex = (v: string | undefined, fallback: string) => (isHexColor(v) ? v.toUpperCase() : fallback);

function tokens(mode: Mode, primary: string, accent: string, menuBg: string): ThemeTokens {
  const S = SURFACES[mode];
  // Filled brand colour: as chosen in light mode; in dark mode lifted until it stands out (3:1, non-text) from the surface.
  const brand = mode === "light" ? primary : ensureContrast(primary, S.surface, 3);
  const onBrand = onColor(brand);
  const brandInk = ensureContrast(primary, [S.surface, S.canvas], 4.5);
  const menu = mode === "light" ? menuBg : mix(S.surface, primary, 0.08);
  const menuInk = contrast(S.ink, menu) >= 4.5 ? S.ink : onColor(menu);
  const menuMuted = contrast(S.muted, menu) >= 4.5 ? S.muted : ensureContrast(mix(menuInk, menu, 0.3), menu, 4.5);
  let menuHover = mix(menu, menuInk, 0.07);
  if (contrast(menuInk, menuHover) < 4.5) menuHover = menu;
  let soft = mode === "light" ? mix(primary, WHITE, 0.9) : mix(primary, S.surface, 0.82);
  if (contrast(S.ink, soft) < 4.5) soft = S.surface;
  const onAccent = onColor(accent);
  return {
    brand, "brand-dark": hoverOf(brand, onBrand), "on-brand": onBrand, "brand-ink": brandInk, "focus-ring": brandInk,
    "brand-soft": soft, "brand-accent": accent, "on-brand-accent": onAccent,
    "menu-bg": menu, "menu-ink": menuInk, "menu-muted": menuMuted, "menu-hover": menuHover,
  };
}

/** Derives the full light + dark theme of a brand. Invalid colours fall back to the platform default. */
export function computeTheme(b: Partial<BrandColors>): Theme {
  const primary = safeHex(b.primaryColor, PLATFORM_BRAND.primaryColor);
  const accent = safeHex(b.accentColor, PLATFORM_BRAND.accentColor);
  const menuBg = safeHex(b.menuBgColor, PLATFORM_BRAND.menuBgColor);
  const light = tokens("light", primary, accent, menuBg);
  const dark = tokens("dark", primary, accent, menuBg);
  return {
    light, dark, font: fontStack(b.headingFont),
    report: {
      onBrand: luminance(light["on-brand"]) > 0.5 ? "light" : "dark",
      buttonRatio: contrast(light["on-brand"], light.brand),
      linkRatio: contrast(light["brand-ink"], SURFACES.light.surface),
      linkAdjusted: light["brand-ink"] !== primary,
      accentRatio: contrast(light["on-brand-accent"], light["brand-accent"]),
      menuRatio: contrast(light["menu-ink"], light["menu-bg"]),
    },
  };
}

/** True when nothing differs from the platform default (the shell then keeps the hand-tuned globals.css theme). */
export function isPlatformDefault(b: Partial<BrandColors>): boolean {
  return safeHex(b.primaryColor, "") === PLATFORM_BRAND.primaryColor && safeHex(b.accentColor, "") === PLATFORM_BRAND.accentColor
    && safeHex(b.menuBgColor, "") === PLATFORM_BRAND.menuBgColor && fontStack(b.headingFont) === fontStack(PLATFORM_BRAND.headingFont);
}

/**
 * Inline style for a `data-brand` wrapper: "--tb-<token>" (light) and "--tbd-<token>" (dark) custom properties.
 * globals.css maps them onto the real tokens, picking the dark set under prefers-color-scheme: dark. Values are
 * computed hex colours and a font stack from the fixed list above (never raw tenant input), and React escapes them.
 */
export function themeStyle(t: Theme): Record<string, string> {
  const out: Record<string, string> = { "--tb-heading-font": t.font };
  for (const k of TOKEN_NAMES) { out[`--tb-${k}`] = t.light[k]; out[`--tbd-${k}`] = t.dark[k]; }
  return out;
}

/** "6.6:1" style label (one decimal, rounded DOWN so it never overstates the ratio). */
export const ratioLabel = (r: number) => `${(Math.floor(r * 10) / 10).toFixed(1)}:1`;
