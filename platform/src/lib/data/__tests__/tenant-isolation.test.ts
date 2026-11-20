// Cross-tenant negative test + behaviour contract for the SQLite DataStore (AGENTS.md: every tenant-owned query is
// tenant scoped). The assertions live in data-store-contract.ts and run unchanged against the Supabase backend too
// (supabase-backend.test.ts offline, supabase-contract-live.test.ts live).
import "../../channels/__tests__/env-secrets";
import { randomUUID } from "node:crypto";
import { getData } from "..";
import { getDb } from "../../db"; // fixture inspection only
import { defineDataStoreContract } from "./data-store-contract";

defineDataStoreContract({
  name: "sqlite",
  store: () => getData(),
  async rawSecret(tenantId, kind, key) {
    const [table, col] = kind === "addon" ? ["addons", "key"] : ["channel_accounts", "channel"];
    const row = getDb().prepare(`SELECT config_enc FROM ${table} WHERE tenant_id=? AND ${col}=?`).get(tenantId, key) as { config_enc: string | null } | undefined;
    return row?.config_enc ?? null;
  },
  async addMember(tenantId, email, name) {
    return getData().users.create({ tenantId, email, name, passwordHash: "x:y" });
  },
  // SQLite: platform admins come from PLATFORM_ADMIN_EMAILS (no table).
  async makePlatformAdmin(tenantId) {
    const adminEmail = `pa-${randomUUID()}@example.test`;
    const admin = await getData().users.create({ tenantId, email: adminEmail, name: "PA", passwordHash: "x:y" });
    const other = await getData().users.create({ tenantId, email: `po-${randomUUID()}@example.test`, name: "PO", passwordHash: "x:y" });
    process.env.PLATFORM_ADMIN_EMAILS = ` other@example.test , ${adminEmail.toUpperCase()} `;
    return { admin, other };
  },
});
