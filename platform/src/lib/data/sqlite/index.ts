// SQLite DataStore (node:sqlite, on-prem / local dev / tests). Wraps the synchronous SQL in async methods.
import type { DataStore } from "../types";
import { addons, channels, secrets } from "./integrations";
import { conversations, messages } from "./inbox";
import { chunks, sections, sources } from "./knowledge";
import { audit, limiter, rateLimits, usage } from "./ops";
import { members, platformAdmins, tenants, users } from "./people";
import { retention } from "./retention";
import { brand, settings } from "./settings";
import { customers, dashboardPrefs, events, notes } from "./team";

export function createSqliteStore(): DataStore {
  return {
    backend: "sqlite",
    tenants, platformAdmins, members, users, settings, brand, sections, sources, chunks, conversations, messages, customers, notes, events, dashboardPrefs,
    addons, channels, secrets, audit, usage, limiter, rateLimits, retention,
  };
}
