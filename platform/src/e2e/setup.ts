// Imported FIRST by every e2e test file (before any app module): isolated temp DATA_DIR, test secrets,
// and a temp working directory (channels/handoff.ts writes the outbox under process.cwd(), see docs/REVIEW-qa.md BUG-1).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";

export const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "inbox-e2e-"));
export const DATA_DIR = path.join(ROOT, "data-dir");
export const FAKE_CWD = path.join(ROOT, "cwd");
/** Where notifyHandoff actually writes today (process.cwd()/data/outbox). */
export const OUTBOX = path.join(FAKE_CWD, "data", "outbox");
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(FAKE_CWD, { recursive: true });

process.env.DATA_DIR = DATA_DIR;
process.env.APP_SECRET = "e2e-app-secret-0123456789abcdef";
process.env.META_APP_SECRET = "e2e-meta-app-secret";
process.env.META_VERIFY_TOKEN = "e2e-verify-token";
process.env.PUBLIC_URL = "https://inbox.test";
delete process.env.OPENAI_API_KEY;

// Never let the outbox land in the real project folder.
vi.spyOn(process, "cwd").mockReturnValue(FAKE_CWD);

// If a previous test file in this worker opened a DB elsewhere, start fresh on our DATA_DIR.
const g = globalThis as { __db?: { close(): void } };
if (g.__db) { try { g.__db.close(); } catch { /* ignore */ } g.__db = undefined; }
