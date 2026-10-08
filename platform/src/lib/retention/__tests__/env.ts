// Imported FIRST by the retention/security tests: isolated temp DATA_DIR + cwd so nothing touches the real data/.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { vi } from "vitest";

export const ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "retention-test-"));
export const DATA_DIR = path.join(ROOT, "data");
export const FAKE_CWD = path.join(ROOT, "cwd");
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(FAKE_CWD, { recursive: true });
process.env.DATA_DIR = DATA_DIR;
process.env.APP_SECRET = "retention-test-secret-0123456789";
process.env.PUBLIC_URL = "https://inbox.test";
delete process.env.RETENTION_DAYS;
delete process.env.LEGAL_HOLD_MASK_DAYS;
delete process.env.OUTBOX_RETENTION_DAYS;
vi.spyOn(process, "cwd").mockReturnValue(FAKE_CWD);

const g = globalThis as { __db?: { close(): void } };
if (g.__db) { try { g.__db.close(); } catch { /* ignore */ } g.__db = undefined; }
