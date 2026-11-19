// Offline stand-in for a SupabaseClient (no network). Records every query chain so tests can assert the filters.
// Results are configured per "table.op" (op = select | insert | update | delete) or per rpc name.
import type { SupabaseClient } from "@supabase/supabase-js";

export type Result = { data: unknown; error: { code?: string; message?: string } | null };
export interface Call { table: string; op: string; args: unknown[]; chain: [string, ...unknown[]][] }

export function fakeSupabase(opts: {
  claims?: { sub: string; email?: string; user_metadata?: Record<string, unknown> } | null;
  results?: Record<string, Result | ((c: Call) => Result)>;
  rpc?: Record<string, Result>;
}) {
  const calls: Call[] = [];
  const rpcCalls: { fn: string; args: unknown }[] = [];
  const resolve = (c: Call): Result => {
    const r = opts.results?.[`${c.table}.${c.op}`];
    if (!r) return { data: c.op === "select" ? [] : null, error: null };
    return typeof r === "function" ? r(c) : r;
  };
  const builder = (call: Call): unknown => {
    const b: Record<string, unknown> = {};
    const chainable = ["eq", "neq", "is", "gt", "lt", "order", "limit", "in", "select"];
    for (const m of chainable) b[m] = (...a: unknown[]) => { call.chain.push([m, ...a]); return b; };
    b.maybeSingle = () => {
      call.chain.push(["maybeSingle"]);
      const r = resolve(call);
      return Promise.resolve({ data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data, error: r.error });
    };
    b.then = (ok: (v: Result) => unknown, bad?: (e: unknown) => unknown) => Promise.resolve(resolve(call)).then(ok, bad);
    return b;
  };
  const client = {
    auth: {
      getClaims: async () => (opts.claims ? { data: { claims: opts.claims }, error: null } : { data: null, error: { message: "no session" } }),
      signOut: async () => ({ error: null }),
    },
    from(table: string) {
      const start = (op: string) => (...args: unknown[]) => { const c: Call = { table, op, args, chain: [] }; calls.push(c); return builder(c); };
      return { select: start("select"), insert: start("insert"), update: start("update"), delete: start("delete") };
    },
    rpc: async (fn: string, args: unknown) => { rpcCalls.push({ fn, args }); return opts.rpc?.[fn] ?? { data: null, error: { message: "unknown" } }; },
  };
  return { client: client as unknown as SupabaseClient, calls, rpcCalls };
}

/** True when the recorded chain has .eq(column, value). */
export const hasEq = (c: Call, col: string, val: unknown) => c.chain.some(([m, a, b]) => m === "eq" && a === col && b === val);
