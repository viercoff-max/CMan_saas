import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const css = readFileSync(path.resolve(__dirname, "../../app/globals.css"), "utf8");
function block(re: RegExp) { const m = css.match(re); if (!m) throw new Error("block not found"); return m[1]; }
const vars = (b: string) => Object.fromEntries([...b.matchAll(/--([\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
const light = vars(block(/:root\s*\{([^}]*)\}/));
const dark = { ...light, ...vars(block(/prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/)) };

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
export const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const PAIRS: [string, string][] = [
  ["on-brand", "brand"], ["on-brand", "brand-dark"], ["on-danger", "danger"],
  ["ok", "surface"], ["warn", "surface"], ["ok", "canvas"], ["warn", "canvas"],
  ["ink", "surface"], ["muted", "surface"], ["muted", "canvas"], ["brand", "surface"], ["danger", "surface"],
];

describe.each([["light", light], ["dark", dark]] as const)("WCAG AA contrast (%s)", (_n, v) => {
  it.each(PAIRS)("%s on %s >= 4.5:1", (fg, bg) => {
    expect(ratio(v[fg], v[bg]), `${fg} ${v[fg]} on ${bg} ${v[bg]}`).toBeGreaterThanOrEqual(4.5);
  });
});
