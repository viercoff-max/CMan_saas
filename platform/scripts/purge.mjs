// Daily retention job: `npm run purge` (optionally `npm run purge -- <tenantId>`).
// Deletes conversations/messages older than RETENTION_DAYS (default 90), keeps safety/legal ones (masks text after 365 days),
// removes outbox files older than 30 days and expired login-attempt rows. Prints counts only.
import { loadApp } from "./lib/bootstrap.mjs";

const tenantId = process.argv[2] || undefined;
const { purgeOldData } = await loadApp("lib/retention/index.ts");
try {
  const r = purgeOldData(tenantId);
  console.log(`[purge] ${new Date().toISOString()} ${JSON.stringify(r)}`);
} catch (e) {
  console.error("[purge] failed:", e instanceof Error ? e.message : e);
  process.exit(1);
}
