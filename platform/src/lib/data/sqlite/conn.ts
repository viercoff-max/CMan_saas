// Shared helpers for the SQLite DataStore. Only src/lib/data/sqlite/** and src/lib/db.ts may touch node:sqlite.
import type { DatabaseSync } from "node:sqlite";
import { getDb, runMigrations } from "../../db";

export type Row = Record<string, unknown>;

const migrated = new WeakSet<DatabaseSync>();
/**
 * The process-wide handle, with the additive migrations applied once per handle (a dev server may hold a handle
 * opened by an older build, and tests swap the handle between files).
 */
export function db(): DatabaseSync {
  const d = getDb();
  if (!migrated.has(d)) { runMigrations(d); migrated.add(d); }
  return d;
}

/** JSON object column -> object ({} on null/invalid). */
export const json = (s: unknown): Record<string, unknown> => {
  try {
    const v = JSON.parse(String(s ?? "{}"));
    return v && typeof v === "object" && !Array.isArray(v) ? v : {};
  } catch { return {}; }
};

/** BEGIN / COMMIT, ROLLBACK on error. Synchronous body (node:sqlite is synchronous). */
export function tx<T>(d: DatabaseSync, fn: () => T): T {
  d.exec("BEGIN");
  try {
    const r = fn();
    d.exec("COMMIT");
    return r;
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
}
