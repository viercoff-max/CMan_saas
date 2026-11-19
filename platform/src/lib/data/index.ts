// Entry point of the data layer: `getData()` returns the DataStore for the configured backend.
//   DATA_BACKEND=sqlite (default)  -> src/lib/data/sqlite (node:sqlite file under DATA_DIR)
//   DATA_BACKEND=supabase          -> reserved for stage 2 (throws DataBackendNotImplementedError for now)
// App code imports ONLY from here (types from ./types); never from ./sqlite or ../db.
// NOTE: relative imports only, so the CLI scripts in scripts/ can load this file with Node's type stripping.
import { DataBackendNotImplementedError } from "./errors";
import { createSqliteStore } from "./sqlite";
import type { DataBackend, DataStore } from "./types";

export { DataConflictError, DataValidationError, DataBackendNotImplementedError } from "./errors";

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
  if (backend === "supabase") throw new DataBackendNotImplementedError(backend);
  g.__dataStore = createSqliteStore();
  return g.__dataStore;
}
