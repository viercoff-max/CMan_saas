// Supabase DataStore (SaaS). SERVER ONLY: built on the service-role client, which bypasses RLS, so every repo
// scopes tenant-owned queries in code through `scoped(db, tenantId)` (see ./client.ts). Tested offline against an
// in-memory fake of the query builder (__tests__/supabase-backend.test.ts) and live with RUN_LIVE=1
// (__tests__/supabase-contract-live.test.ts).
import type { DataStore } from "../types";
import { createServiceClient, type Db } from "./client";
import { conversationsRepo, messagesRepo } from "./inbox";
import { addonsRepo, channelsRepo, secretsRepo } from "./integrations";
import { chunksRepo, sectionsRepo, sourcesRepo } from "./knowledge";
import { auditRepo, limiterRepo, rateLimitsRepo, usageRepo } from "./ops";
import { membersRepo, platformAdminsRepo, tenantsRepo, usersRepo } from "./people";
import { retentionRepo } from "./retention";
import { brandRepo, settingsRepo } from "./settings";
import { customersRepo, dashboardPrefsRepo, eventsRepo, notesRepo } from "./team";

/** `db` is injectable for tests; by default the service-role client from the environment. */
export function createSupabaseStore(db: Db = createServiceClient()): DataStore {
  return {
    backend: "supabase",
    tenants: tenantsRepo(db), platformAdmins: platformAdminsRepo(db), members: membersRepo(db), users: usersRepo(db),
    settings: settingsRepo(db), brand: brandRepo(db),
    sections: sectionsRepo(db), sources: sourcesRepo(db), chunks: chunksRepo(db),
    conversations: conversationsRepo(db), messages: messagesRepo(db),
    customers: customersRepo(db), notes: notesRepo(db), events: eventsRepo(db), dashboardPrefs: dashboardPrefsRepo(db),
    addons: addonsRepo(db), channels: channelsRepo(db), secrets: secretsRepo(db),
    audit: auditRepo(db), usage: usageRepo(db), limiter: limiterRepo(db), rateLimits: rateLimitsRepo(db),
    retention: retentionRepo(db),
  };
}
