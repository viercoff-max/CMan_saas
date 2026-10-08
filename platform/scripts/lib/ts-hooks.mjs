// Node module hooks so CLI scripts can import the app's TypeScript (src/lib/**) with Node 24's built-in type
// stripping, without adding a dependency: resolves extensionless imports to .ts and the "@/" alias to src/.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "src");

function tryFile(base) {
  for (const cand of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
    try { if (fs.statSync(cand).isFile()) return cand; } catch { /* next */ }
  }
  return null;
}

export async function resolve(specifier, context, next) {
  let base = null;
  if (specifier.startsWith("file:") && specifier.endsWith(".ts")) return { url: specifier, format: "module-typescript", shortCircuit: true };
  if (specifier.startsWith("@/")) base = path.join(SRC, specifier.slice(2));
  else if ((specifier.startsWith("./") || specifier.startsWith("../")) && context.parentURL?.startsWith("file:") && context.parentURL.endsWith(".ts"))
    base = path.resolve(path.dirname(fileURLToPath(context.parentURL)), specifier);
  if (base) {
    const file = tryFile(base);
    if (file) return { url: pathToFileURL(file).href, format: file.endsWith(".ts") ? "module-typescript" : undefined, shortCircuit: true };
  }
  return next(specifier, context);
}
