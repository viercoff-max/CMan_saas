// Imported FIRST: isolated temp DATA_DIR so the real data/ folder is never touched.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "demo-test-"));
export const DATA_DIR = path.join(ROOT, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });
process.env.DATA_DIR = DATA_DIR;
process.env.APP_SECRET = "demo-test-secret-0123456789abcdef";
process.env.PUBLIC_URL = "http://localhost:3000";
(process.env as Record<string, string>).NODE_ENV = "test";
const g = globalThis as { __db?: { close(): void } };
if (g.__db) { try { g.__db.close(); } catch { /* ignore */ } g.__db = undefined; }
