// ARCO / Meta / Shopify per-customer requests.
//   npm run delete-customer -- <channel> <externalId> [--tenant chefman] [--export file.json] [--force]
//   channel: messenger | instagram | whatsapp | simulator. externalId: the id shown in the inbox (PSID, IG id, phone).
//   --export writes everything we hold to a JSON file first (ARCO acceso); --export-only skips the deletion.
//   --force also deletes conversations on legal hold (safety/legal escalations). Ask the owner/lawyer first.
import fs from "node:fs";
import { loadApp } from "./lib/bootstrap.mjs";

const args = process.argv.slice(2);
const flag = (name) => { const i = args.indexOf(name); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const bool = (name) => { const i = args.indexOf(name); if (i < 0) return false; args.splice(i, 1); return true; };
const tenantId = flag("--tenant") ?? "chefman";
const exportFile = flag("--export");
const exportOnly = bool("--export-only");
const force = bool("--force");
const [channel, externalId] = args;

if (!["messenger", "instagram", "whatsapp", "simulator"].includes(channel ?? "") || !externalId) {
  console.error("Usage: npm run delete-customer -- <messenger|instagram|whatsapp|simulator> <externalId> [--tenant chefman] [--export file.json] [--export-only] [--force]");
  process.exit(2);
}
const { deleteCustomerData, exportCustomerData } = await loadApp("lib/retention/index.ts");

if (exportFile || exportOnly) {
  const data = exportCustomerData(tenantId, channel, externalId, { actor: "cli" });
  const out = exportFile ?? `export-${channel}-${Date.now()}.json`;
  fs.writeFileSync(out, JSON.stringify(data, null, 2), "utf8");
  console.log(`Exported ${data.conversations.length} conversation(s) to ${out}. Send it to the customer and then delete the file.`);
  if (exportOnly) process.exit(0);
}
const r = deleteCustomerData(tenantId, channel, externalId, { force, actor: "cli" });
console.log(`Deleted ${r.conversations} conversation(s), ${r.messages} message(s), ${r.outboxFiles} outbox file(s). Reference: ${r.ref}`);
if (r.heldConversations) console.log(`${r.heldConversations} conversation(s) kept on legal hold (safety/legal). Re-run with --force only if the owner approves.`);
