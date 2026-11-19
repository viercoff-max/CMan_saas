// LIVE: the DataStore contract against a REAL Supabase project. Excluded from `npm test` by the *-live pattern
// (vitest.config.ts). Run ONLY with owner approval, on a TEST project with the stage-1 and stage-2 migrations applied:
//   RUN_LIVE=1 NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SECRET_KEY=... APP_SECRET=... npx vitest run src/lib/data/__tests__/supabase-contract-live.test.ts
// It creates tenants with slugs "ta-<uuid>", "sec-<uuid>"... and deletes them (cascade) afterwards.
// Members are not created (that needs Supabase Auth users), so the members checks are skipped.
import { afterAll, describe, it } from "vitest";
import type { DataStore } from "../types";
import { createSupabaseStore } from "../supabase";
import { createServiceClient, type Db } from "../supabase/client";
import { defineDataStoreContract } from "./data-store-contract";

const enabled = process.env.RUN_LIVE === "1" && !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SECRET_KEY && !!process.env.APP_SECRET;

if (!enabled) {
  describe.skip("DataStore contract [supabase live] (set RUN_LIVE=1 + Supabase env vars)", () => { it("skipped", () => {}); });
} else {
  const db: Db = createServiceClient();
  const created = new Set<string>();
  const base = createSupabaseStore(db);
  // Track every tenant the suite creates so it can be removed afterwards.
  const store: DataStore = {
    ...base,
    tenants: { ...base.tenants, ensure: async (k, n) => { const id = await base.tenants.ensure(k, n); created.add(id); return id; } },
  };

  defineDataStoreContract({
    name: "supabase live",
    store: () => store,
    async rawSecret(tenantId, kind, key) {
      const { data } = await db.from("tenant_secrets").select("config_enc").eq("tenant_id", tenantId).eq("kind", kind).eq("key", key).maybeSingle();
      return ((data as { config_enc?: string } | null)?.config_enc) ?? null;
    },
  });

  afterAll(async () => {
    for (const id of created) await db.from("tenants").delete().eq("id", id); // ON DELETE CASCADE removes their rows
  });
}
