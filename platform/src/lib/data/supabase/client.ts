// SERVER ONLY. The Supabase service-role client used by the Supabase DataStore, plus the small query-builder
// contract (`Db`) the store is written against, so tests can inject an in-memory fake (__tests__/supabase-fake.ts).
//
// The service role BYPASSES RLS. Tenant isolation is therefore enforced in code: every query on a tenant-owned
// table goes through `scoped(db, tenantId)`, which adds `tenant_id = <tenantId>` to every select/update/delete and
// stamps tenant_id on every inserted/upserted row. Only the few documented cross-tenant lookups use `db` directly.
//
// Never import this module (or anything under src/lib/data/supabase) from a "use client" file
// (guarded by __tests__/supabase-boundary.test.ts). Never log the key.
// NOTE: relative, type-only imports (the CLI scripts load src/lib with Node's type stripping).
import { createClient } from "@supabase/supabase-js";
import { DataValidationError } from "../errors";

export type Row = Record<string, unknown>;
export interface DbError { code?: string; message?: string; details?: string; hint?: string }
export interface DbResult<T = unknown> { data: T | null; error: DbError | null; count?: number | null }

/** The subset of the supabase-js (PostgREST) builder used by the Supabase store. Same names and semantics. */
export interface Query extends PromiseLike<DbResult> {
  select(columns?: string): Query;
  eq(column: string, value: unknown): Query;
  neq(column: string, value: unknown): Query;
  in(column: string, values: readonly unknown[]): Query;
  is(column: string, value: null | boolean): Query;
  lt(column: string, value: unknown): Query;
  lte(column: string, value: unknown): Query;
  gt(column: string, value: unknown): Query;
  gte(column: string, value: unknown): Query;
  like(column: string, pattern: string): Query;
  ilike(column: string, pattern: string): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  limit(count: number): Query;
  range(from: number, to: number): Query;
  maybeSingle(): PromiseLike<DbResult>;
}
export interface Table {
  select(columns?: string, options?: { count?: "exact"; head?: boolean }): Query;
  insert(values: Row | Row[]): Query;
  upsert(values: Row | Row[], options?: { onConflict?: string; ignoreDuplicates?: boolean }): Query;
  update(values: Row): Query;
  delete(options?: { count?: "exact" }): Query;
}
export interface AuthUser { id: string; email?: string | null; user_metadata?: Record<string, unknown> | null }

/** The subset of supabase-js Storage (storage-js) used by src/lib/storage/supabase.ts. Same names and semantics. */
export interface StorageError { message?: string; statusCode?: string; status?: number }
export interface StorageObject {
  name: string; id: string | null; updated_at?: string | null; created_at?: string | null;
  metadata?: Record<string, unknown> | null;
}
export interface StorageBucketApi {
  upload(path: string, body: Uint8Array, options?: { contentType?: string; upsert?: boolean; cacheControl?: string }):
    PromiseLike<{ data: { path: string } | null; error: StorageError | null }>;
  download(path: string): PromiseLike<{ data: Blob | null; error: StorageError | null }>;
  remove(paths: string[]): PromiseLike<{ data: unknown; error: StorageError | null }>;
  list(prefix?: string, options?: { limit?: number; offset?: number; search?: string; sortBy?: { column: string; order: "asc" | "desc" } }):
    PromiseLike<{ data: StorageObject[] | null; error: StorageError | null }>;
  getPublicUrl(path: string): { data: { publicUrl: string } };
}
export interface Db {
  from(table: string): Table;
  rpc(fn: string, args?: Row): PromiseLike<DbResult>;
  auth: { admin: { getUserById(id: string): PromiseLike<{ data: { user: AuthUser | null } | null; error: DbError | null }> } };
  storage: { from(bucket: string): StorageBucketApi };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): boolean => typeof v === "string" && UUID.test(v);

/**
 * Tenant ids are uuids in Supabase. A non-uuid tenant id (e.g. a SQLite-era "chefman" session) is a programming
 * error: fail loudly instead of querying.
 */
export function assertTenantId(tenantId: string): string {
  if (!isUuid(tenantId)) throw new DataValidationError("tenantId");
  return tenantId.toLowerCase();
}

const stamp = (v: Row | Row[], tenantId: string): Row | Row[] =>
  Array.isArray(v) ? v.map((r) => ({ ...r, tenant_id: tenantId })) : { ...v, tenant_id: tenantId };

/** Tenant-scoped view of the client: the ONLY way the store touches tenant-owned tables. */
export interface Scoped {
  readonly tenantId: string;
  from(table: string): Table;
  /** RPC with `p_tenant` forced to this tenant. */
  rpc(fn: string, args?: Row): PromiseLike<DbResult>;
}
export function scoped(db: Db, tenantId: string): Scoped {
  const tid = assertTenantId(tenantId);
  return {
    tenantId: tid,
    from(table) {
      const t = db.from(table);
      return {
        select: (columns, options) => t.select(columns, options).eq("tenant_id", tid),
        insert: (values) => t.insert(stamp(values, tid)),
        upsert: (values, options) => t.upsert(stamp(values, tid), options),
        update: (values) => {
          const v = { ...values };
          delete v.tenant_id; // a row never moves to another tenant
          return t.update(v).eq("tenant_id", tid);
        },
        delete: (options) => t.delete(options).eq("tenant_id", tid),
      };
    },
    rpc: (fn, args = {}) => db.rpc(fn, { ...args, p_tenant: tid }),
  };
}

/** Service-role client from NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SECRET_KEY. Throws a clear error when missing. */
export function createServiceClient(env: Record<string, string | undefined> = process.env): Db {
  if (typeof window !== "undefined") throw new Error("The Supabase service client is server-only.");
  const url = env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = env.SUPABASE_SECRET_KEY?.trim();
  const missing = [!url && "NEXT_PUBLIC_SUPABASE_URL", !key && "SUPABASE_SECRET_KEY"].filter(Boolean);
  if (missing.length) {
    throw new Error(`DATA_BACKEND=supabase needs ${missing.join(" and ")} in .env.local (server only; see .env.example).`);
  }
  const client = createClient(url!, key!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { "x-client-info": "momentia-data-layer" } },
  });
  return client as unknown as Db;
}
