// The Supabase backend holds the SERVICE-ROLE key (bypasses RLS): it must never reach a browser bundle.
//   * no "use client" file imports src/lib/data/supabase, or the data layer at runtime (type-only imports are fine);
//   * outside src/lib/data, nobody imports src/lib/data/supabase directly (getData() picks the backend);
//   * no "use client" file mentions the service key.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../../..");
const rel = (f: string) => path.relative(SRC, f).split(path.sep).join("/");
function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|js|mjs|jsx)$/.test(e.name)) out.push(p);
  }
  return out;
}
const isTest = (r: string) => /\.test\.tsx?$/.test(r) || r.includes("/__tests__/");
const isClient = (text: string) => /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*\s*["']use client["']/.test(text);
/** Non-type import specifiers of a file (`import type ...` and `export type ... from` are ignored). */
function runtimeImports(text: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(import|export)\s+(?!type\b)(?:[^"';]*?\sfrom\s+)?["']([^"']+)["']/g;
  for (let m; (m = re.exec(text)); ) out.push(m[2]);
  for (const m of text.matchAll(/import\(\s*["']([^"']+)["']\s*\)/g)) out.push(m[1]);
  return out;
}
const pointsTo = (spec: string, file: string, target: RegExp) => {
  const resolved = spec.startsWith("@/") ? spec.slice(2) : spec.startsWith(".") ? rel(path.resolve(path.dirname(file), spec)) : spec;
  return target.test(resolved);
};

describe("supabase service client boundary", () => {
  const files = walk(SRC).map((f) => ({ f, r: rel(f), text: fs.readFileSync(f, "utf8") }));

  it("detects client components (sanity)", () => {
    expect(files.some(({ text }) => isClient(text))).toBe(true);
    expect(runtimeImports('import type { A } from "@/lib/data";\nimport { getData } from "@/lib/data";')).toEqual(["@/lib/data"]);
  });

  it('no "use client" file imports the data layer at runtime', () => {
    const offenders = files.filter(({ text }) => isClient(text))
      .flatMap(({ f, r, text }) => runtimeImports(text).filter((s) => pointsTo(s, f, /^lib\/data(\/|$)|^@supabase\/supabase-js$/)).map((s) => `${r}: ${s}`));
    expect(offenders).toEqual([]);
  });

  it("only src/lib/data imports src/lib/data/supabase", () => {
    const offenders = files.filter(({ r }) => !r.startsWith("lib/data/"))
      .flatMap(({ f, r, text }) => runtimeImports(text).filter((s) => pointsTo(s, f, /^lib\/data\/supabase(\/|$)/)).map((s) => `${r}: ${s}`));
    expect(offenders).toEqual([]);
  });

  it('no "use client" file mentions the service key', () => {
    const offenders = files.filter(({ r, text }) => !isTest(r) && isClient(text) && /SUPABASE_SECRET_KEY|service_role/.test(text)).map(({ r }) => r);
    expect(offenders).toEqual([]);
  });
});
