// Demo data for the LOCAL database: `npm run demo` (seed) / `npm run demo -- --reset` (remove only the demo rows).
// Refuses to run when NODE_ENV=production or PUBLIC_URL is not localhost/127.0.0.1. Never prints env values.
import { loadApp } from "./lib/bootstrap.mjs";

const reset = process.argv.includes("--reset");
const tenantArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const demo = await loadApp("lib/demo/index.ts");
try {
  demo.assertDemoAllowed();
  const tenantId = tenantArg || demo.DEMO_TENANT;
  if (reset) {
    const r = demo.resetDemo(tenantId);
    console.log(`[demo] reset: removed ${r.conversations} demo conversations and ${r.sources} demo sources; original context/settings restored where unchanged.`);
  } else {
    const r = demo.seedDemo(tenantId);
    console.log(`[demo] seeded tenant '${tenantId}': ${r.sections} context sections, ${r.sources} sources, ${r.conversations} conversations (${r.messages} messages), Shopify demo store connected.`);
    console.log("[demo] remove with: npm run demo -- --reset");
  }
} catch (e) {
  console.error("[demo] failed:", e instanceof Error ? e.message : "error");
  process.exit(1);
}
