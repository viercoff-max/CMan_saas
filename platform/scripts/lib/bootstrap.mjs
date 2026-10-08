// Shared CLI setup: load .env.local (same config as the app), register the TS hooks, import a module from src/lib.
import fs from "node:fs";
import path from "node:path";
import { register } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function loadApp(relModule) {
  for (const f of [".env.local", ".env"]) {
    const p = path.join(ROOT, f);
    // Values already set in the environment (e.g. by Task Scheduler) win over the file.
    if (fs.existsSync(p)) process.loadEnvFile(p);
  }
  if (!process.env.APP_SECRET) {
    console.error("APP_SECRET is not set (.env.local missing?). Run from the project folder.");
    process.exit(1);
  }
  process.chdir(ROOT); // DATA_DIR default and the legacy outbox are relative to the project folder
  register(pathToFileURL(path.join(ROOT, "scripts", "lib", "ts-hooks.mjs")).href);
  return import(pathToFileURL(path.join(ROOT, "src", relModule)).href);
}
