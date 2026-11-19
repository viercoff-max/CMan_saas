// Enforces the data-layer boundary: only src/lib/data/sqlite/** and src/lib/db.ts may use node:sqlite / getDb() /
// raw SQL statements. Everything else goes through getData() (src/lib/data). Tests that build SQL fixtures are exempt.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "../../..");
const rel = (f: string) => path.relative(SRC, f).split(path.sep).join("/");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|mts|js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

const isTest = (r: string) => /\.test\.tsx?$/.test(r) || r.includes("/__tests__/") || r.startsWith("e2e/");
const isAllowed = (r: string) => r === "lib/db.ts" || r.startsWith("lib/data/sqlite/");

const RULES: { name: string; re: RegExp }[] = [
  { name: "imports node:sqlite", re: /from\s+["']node:sqlite["']|require\(\s*["']node:sqlite["']\s*\)/ },
  { name: "calls getDb()", re: /\bgetDb\s*\(/ },
  { name: "imports getDb/runMigrations from db", re: /import\s*\{[^}]*\b(getDb|runMigrations)\b[^}]*\}\s*from\s*["'][^"']*\bdb["']/ },
  { name: "prepares SQL statements", re: /\.prepare\(\s*[`"']/ },
  { name: "imports the SQLite store directly", re: /from\s+["'][^"']*data\/sqlite(\/[^"']*)?["']/ },
  { name: "imports the removed store.ts", re: /from\s+["'](@\/lib\/store|\.{1,2}(\/\.\.)*\/store)["']/ },
];

describe("data layer boundary", () => {
  const files = walk(SRC).map((f) => ({ f, r: rel(f) })).filter(({ r }) => !isTest(r));

  it("scans the app source tree", () => {
    expect(files.length).toBeGreaterThan(50);
    expect(files.some(({ r }) => r === "lib/data/index.ts")).toBe(true);
  });

  it("only src/lib/data/sqlite/** and src/lib/db.ts touch node:sqlite, getDb() or raw SQL", () => {
    const offenders: string[] = [];
    for (const { f, r } of files) {
      if (isAllowed(r)) continue;
      const text = fs.readFileSync(f, "utf8");
      for (const rule of RULES) {
        if (r === "lib/data/index.ts" && rule.name === "imports the SQLite store directly") continue; // picks the backend
        if (rule.re.test(text)) offenders.push(`${r}: ${rule.name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("the old per-module SQL files are gone", () => {
    for (const r of ["lib/store.ts", "lib/engine/repo.ts", "lib/context/tone-saved.ts"]) expect(fs.existsSync(path.join(SRC, r)), r).toBe(false);
  });
});
