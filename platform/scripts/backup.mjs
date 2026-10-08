// Consistent online backup of the SQLite database: `npm run backup` (optionally `npm run backup -- D:\Backups\SocialInbox`).
// Uses SQLite's backup API (safe while the app is running). Keeps the newest 14 copies; older ones are deleted so
// backups never outlive the retention policy by much. Backups hold customer data: keep them on an encrypted
// (BitLocker) disk that is NOT synced to OneDrive.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync, backup } from "node:sqlite";
import { loadApp } from "./lib/bootstrap.mjs";

const KEEP = 14;
const { DATA_DIR } = await loadApp("lib/db.ts");
const dest = path.resolve(process.argv[2] || path.join(DATA_DIR, "..", "backups"));
fs.mkdirSync(dest, { recursive: true });
const src = path.join(DATA_DIR, "app.db");
if (!fs.existsSync(src)) {
  console.error(`No database at ${src}`);
  process.exit(1);
}
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const out = path.join(dest, `app-${stamp}.db`);
const db = new DatabaseSync(src, { readOnly: true });
await backup(db, out);
db.close();
const old = fs.readdirSync(dest).filter((f) => /^app-.*\.db$/.test(f)).sort().reverse().slice(KEEP);
for (const f of old) fs.unlinkSync(path.join(dest, f));
console.log(`[backup] ${out} (removed ${old.length} old copies)`);
