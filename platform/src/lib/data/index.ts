// Entry point of the data layer: `getData()` returns the DataStore for the configured backend.
//   DATA_BACKEND=sqlite (default)  -> src/lib/data/sqlite (node:sqlite file under DATA_DIR)
//   DATA_BACKEND=supabase          -> src/lib/data/supabase (service-role client; needs NEXT_PUBLIC_SUPABASE_URL +
//                                     SUPABASE_SECRET_KEY; tenant ids are uuids). SERVER ONLY.
// App code imports ONLY from here (types from ./types); never from ./sqlite, ./supabase or ../db.
// NOTE: relative imports only, so the CLI scripts in scripts/ can load this file with Node's type stripping.
import { createSqliteStore } from "./sqlite";
import { createSupabaseStore } from "./supabase";
import type { DataBackend, DataStore } from "./types";

export {
  DataBackendError, DataBackendNotImplementedError, DataBackendUnsupportedError, DataConflictError, DataValidationError,
} from "./errors";

export function dataBackend(env: Record<string, string | undefined> = process.env): DataBackend {
  const v = (env.DATA_BACKEND ?? "").trim().toLowerCase();
  if (!v || v === "sqlite") return "sqlite";
  if (v === "supabase") return "supabase";
  throw new Error(`Unknown DATA_BACKEND "${v}" (expected "sqlite" or "supabase").`);
}

const g = globalThis as { __dataStore?: DataStore };

export function getData(): DataStore {
  const backend = dataBackend();
  if (g.__dataStore?.backend === backend) return g.__dataStore;
  g.__dataStore = backend === "supabase" ? createSupabaseStore() : createSqliteStore();
  return g.__dataStore;
}
