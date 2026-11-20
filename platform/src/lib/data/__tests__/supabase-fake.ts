// In-memory fake of the supabase-js query builder (the `Db` subset in src/lib/data/supabase/client.ts), for offline
// tests of the Supabase DataStore. Not a test file itself (no .test.ts suffix).
//
// It models what the store relies on from Postgres/PostgREST: column defaults, primary keys and unique indexes
// (incl. the partial uq_channel_external / uq_msg_provider) with 23505 errors and constraint names, upsert
// on_conflict / ignore-duplicates merging ONLY the sent columns, the tenant FK and composite tenant FKs (23503),
// uuid typing (22P02), maybeSingle (PGRST116), count/head, range/limit/order, LIKE escapes, and the stage-2 RPCs
// (same semantics as supabase/migrations/20261120100000_* and 20261120100100_*).
// Every executed query is recorded in `log` so tests can assert that tenant-owned queries carry a tenant_id filter.
// The live suite (supabase-contract-live.test.ts) checks the same behaviour against a real project.
import { randomUUID } from "node:crypto";
import type { AuthUser, Db, DbError, DbResult, Query, Row, StorageBucketApi, StorageError, StorageObject, Table } from "../supabase/client";

type Op = "eq" | "neq" | "in" | "is" | "lt" | "lte" | "gt" | "gte" | "like" | "ilike";
export interface Filter { op: Op; col: string; val: unknown }
export interface Recorded {
  kind: "select" | "insert" | "upsert" | "update" | "delete" | "rpc";
  table: string; filters: Filter[]; rows?: Row[]; patch?: Row; args?: Row; columns?: string;
}

// Strictly increasing clock (Postgres now() differs per request at microsecond precision; ms can tie here).
let lastMs = 0;
const now = () => { lastMs = Math.max(Date.now(), lastMs + 1); return new Date(lastMs).toISOString(); };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_COLS = new Set(["tenant_id", "conversation_id", "source_id", "file_source_id", "user_id"]);
const UUID_ID_TABLES = new Set(["tenants", "sources", "chunks", "conversations", "messages", "audit_log"]);

interface Unique { name: string; cols: string[]; where?: (r: Row) => boolean }
interface Spec { unique: Unique[]; defaults: () => Row; tenant: boolean; nullableTenant?: boolean; refs?: { cols: [string, string]; table: string; to: [string, string] }[] }
const pk = (t: string, cols: string[]): Unique => ({ name: `${t}_pkey`, cols });
const uq = (t: string, cols: string[]): Unique => ({ name: `${t}_${cols.join("_")}_key`, cols });
let serial = 0;
const bigId = () => ++serial;

export const SCHEMA: Record<string, Spec> = {
  tenants: { tenant: false, unique: [pk("tenants", ["id"]), uq("tenants", ["slug"])], defaults: () => ({ id: randomUUID(), plan: "free", status: "active", ai_monthly_token_cap: 300000, created_at: now() }) },
  tenant_members: { tenant: true, unique: [pk("tenant_members", ["tenant_id", "user_id"])], defaults: () => ({ created_at: now() }) },
  platform_admins: { tenant: false, unique: [pk("platform_admins", ["user_id"])], defaults: () => ({ created_at: now() }) },
  brand_settings: { tenant: true, unique: [pk("brand_settings", ["tenant_id"])], defaults: () => ({ display_name: "", logo_path: null, primary_color: "#0F766E", accent_color: "#14181F", menu_bg_color: "#F6F7F9", heading_font: "system", updated_at: now() }) },
  agent_settings: { tenant: true, unique: [pk("agent_settings", ["tenant_id"])], defaults: () => ({ agent_name: "Asistente", tone_level: 3, language_default: "es", language_alt: "en", greeting: "", fallback_message: "", handoff_email: "", business_hours: {}, cross_sell_level: 1, bot_enabled: true, tone_saved_at: null, updated_at: now() }) },
  sources: { tenant: true, unique: [pk("sources", ["id"]), uq("sources", ["tenant_id", "id"])], defaults: () => ({ id: randomUUID(), url: null, storage_path: null, status: "pending", error: null, content_text: null, last_synced_at: null, created_at: now() }) },
  context_sections: {
    tenant: true, unique: [pk("context_sections", ["tenant_id", "key"])], defaults: () => ({ content: "", mode: "text", file_source_id: null, updated_at: now() }),
    refs: [{ cols: ["tenant_id", "file_source_id"], table: "sources", to: ["tenant_id", "id"] }],
  },
  section_sources: {
    tenant: true, unique: [pk("section_sources", ["tenant_id", "section_key", "source_id"])], defaults: () => ({ created_at: now() }),
    refs: [{ cols: ["tenant_id", "source_id"], table: "sources", to: ["tenant_id", "id"] }],
  },
  chunks: {
    tenant: true, unique: [pk("chunks", ["id"])], defaults: () => ({ id: randomUUID(), source_id: null, section_key: null, title: "", created_at: now() }),
    refs: [{ cols: ["tenant_id", "source_id"], table: "sources", to: ["tenant_id", "id"] }],
  },
  channel_accounts: {
    tenant: true,
    unique: [pk("channel_accounts", ["tenant_id", "channel"]), uq("channel_accounts", ["webhook_id"]),
      { name: "uq_channel_external", cols: ["channel", "external_id"], where: (r) => r.status === "connected" && r.external_id != null }],
    defaults: () => ({ status: "disconnected", external_id: null, display_name: "", webhook_id: randomUUID(), public_info: {}, connected_at: null }),
  },
  addons: { tenant: true, unique: [pk("addons", ["tenant_id", "key"])], defaults: () => ({ status: "disconnected", public_info: {}, connected_at: null }) },
  tenant_secrets: { tenant: true, unique: [pk("tenant_secrets", ["tenant_id", "kind", "key"])], defaults: () => ({ config_enc: null, webhook_secret_hash: null, updated_at: now() }) },
  conversations: {
    tenant: true, unique: [pk("conversations", ["id"]), uq("conversations", ["tenant_id", "channel", "external_id"]), uq("conversations", ["tenant_id", "id"])],
    defaults: () => ({ id: randomUUID(), customer_name: "", status: "bot", escalation_reason: null, assigned_to: null, state: {}, last_message_at: now(), last_inbound_at: null, unread: 0, legal_hold: false, created_at: now() }),
  },
  messages: {
    tenant: true,
    unique: [pk("messages", ["id"]), { name: "uq_msg_provider", cols: ["tenant_id", "conversation_id", "provider_message_id"], where: (r) => r.provider_message_id != null }],
    defaults: () => ({ id: randomUUID(), agent_user_id: null, meta: {}, provider_message_id: null, created_at: now() }),
    refs: [{ cols: ["tenant_id", "conversation_id"], table: "conversations", to: ["tenant_id", "id"] }],
  },
  ai_usage: { tenant: true, unique: [pk("ai_usage", ["tenant_id", "period"])], defaults: () => ({ requests: 0, input_tokens: 0, output_tokens: 0, updated_at: now() }) },
  // tenant_id is nullable in Postgres (global rows); the fake's tenant FK check skips null tenant ids for this table.
  audit_log: { tenant: true, nullableTenant: true, unique: [pk("audit_log", ["id"])], defaults: () => ({ id: randomUUID(), actor_user_id: null, detail: "", created_at: now() }) },
  rate_limits: { tenant: false, unique: [pk("rate_limits", ["key"])], defaults: () => ({}) },
  login_attempts: { tenant: false, unique: [pk("login_attempts", ["id"])], defaults: () => ({ id: bigId(), at: now() }) },
  engine_lookup_failures: { tenant: true, unique: [pk("engine_lookup_failures", ["id"])], defaults: () => ({ id: bigId(), at: now() }) },
  engine_inbound_log: { tenant: true, unique: [pk("engine_inbound_log", ["id"])], defaults: () => ({ id: bigId(), at: now() }) },
};
export const TENANT_TABLES = Object.entries(SCHEMA).filter(([, s]) => s.tenant).map(([t]) => t);

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const err = (code: string, message = ""): DbError => ({ code, message, details: "redacted-test-detail" });
class Fail extends Error { readonly e: DbError; constructor(e: DbError) { super(e.message); this.e = e; } }

function likeToRegex(p: string, flags: string): RegExp {
  let s = "";
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === "\\" && i + 1 < p.length) s += p[++i].replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    else if (c === "%") s += ".*";
    else if (c === "_") s += ".";
    else s += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${s}$`, flags);
}
const cmp = (a: unknown, b: unknown) => (typeof a === "number" && typeof b === "number" ? a - b : String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0);
function test(r: Row, f: Filter): boolean {
  const v = r[f.col];
  switch (f.op) {
    case "eq": return v != null && f.val != null && cmp(v, f.val) === 0;
    case "neq": return v != null && f.val != null && cmp(v, f.val) !== 0;
    case "in": return v != null && (f.val as unknown[]).some((x) => cmp(v, x) === 0);
    case "is": return f.val === null ? v == null : v === f.val;
    case "lt": return v != null && cmp(v, f.val) < 0;
    case "lte": return v != null && cmp(v, f.val) <= 0;
    case "gt": return v != null && cmp(v, f.val) > 0;
    case "gte": return v != null && cmp(v, f.val) >= 0;
    case "like": return v != null && likeToRegex(String(f.val), "").test(String(v));
    case "ilike": return v != null && likeToRegex(String(f.val), "i").test(String(v));
  }
}

export class FakeSupabase implements Db {
  readonly tables: Record<string, Row[]> = Object.fromEntries(Object.keys(SCHEMA).map((t) => [t, []]));
  readonly log: Recorded[] = [];
  readonly authUsers = new Map<string, AuthUser>();
  private failures: { table: string; error: DbError }[] = [];

  /** The next query on `table` (or rpc name) returns `error`. */
  failNext(table: string, error: DbError) { this.failures.push({ table, error }); }
  takeFailure(table: string): DbError | null {
    const i = this.failures.findIndex((f) => f.table === table);
    return i < 0 ? null : this.failures.splice(i, 1)[0].error;
  }

  /** Test helper: an auth user with a membership (Supabase Auth owns users; the store only reads them). */
  addMember(tenantId: string, user: { email: string; name: string; role?: string }): string {
    const id = randomUUID();
    this.authUsers.set(id, { id, email: user.email, user_metadata: { name: user.name } });
    this.tables.tenant_members.push({ tenant_id: tenantId, user_id: id, role: user.role ?? "admin", created_at: now() });
    return id;
  }

  /** In-memory Supabase Storage (same bucket rules as the init migration: size limit + allowed MIME types). */
  readonly storageFake = new FakeStorage();
  readonly storage = { from: (bucket: string): StorageBucketApi => this.storageFake.bucket(bucket) };

  auth = {
    admin: {
      getUserById: async (id: string) => {
        const u = this.authUsers.get(id);
        return u ? { data: { user: clone(u) }, error: null } : { data: { user: null }, error: err("user_not_found") };
      },
    },
  };

  from(table: string): Table {
    if (!SCHEMA[table]) throw new Error(`fake: unknown table ${table}`);
    const q = (kind: Recorded["kind"], init: Partial<QState> = {}) => new FakeQuery(this, { table, kind, filters: [], orders: [], ...init });
    return {
      select: (columns = "*", o = {}) => q("select", { columns, count: o.count === "exact", head: !!o.head }),
      insert: (v) => q("insert", { rows: Array.isArray(v) ? v : [v] }),
      upsert: (v, o = {}) => q("upsert", { rows: Array.isArray(v) ? v : [v], onConflict: o.onConflict, ignoreDuplicates: !!o.ignoreDuplicates }),
      update: (v) => q("update", { patch: v }),
      delete: (o = {}) => q("delete", { count: o.count === "exact" }),
    };
  }

  async rpc(fn: string, args: Row = {}): Promise<DbResult> {
    this.log.push({ kind: "rpc", table: fn, filters: [], args: clone(args) });
    const forced = this.takeFailure(fn);
    if (forced) return { data: null, error: forced };
    const impl = RPCS[fn];
    if (!impl) return { data: null, error: err("PGRST202", `Could not find the function public.${fn}`) };
    const snapshot = clone(this.tables);
    try {
      return { data: clone(impl(this, args)), error: null };
    } catch (e) {
      Object.assign(this.tables, snapshot);
      if (e instanceof Fail) return { data: null, error: e.e };
      throw e;
    }
  }

  // ---------------------------------------------------------------- engine
  checkUuid(table: string, r: Row) {
    for (const [k, v] of Object.entries(r)) {
      if (v == null) continue;
      if ((UUID_COLS.has(k) || (k === "id" && UUID_ID_TABLES.has(table))) && !UUID.test(String(v)))
        throw new Fail(err("22P02", `invalid input syntax for type uuid`));
    }
  }
  checkConstraints(table: string, rows: Row[]) {
    const spec = SCHEMA[table];
    for (const u of spec.unique) {
      const seen = new Set<string>();
      for (const r of rows) {
        if (u.where && !u.where(r)) continue;
        if (u.cols.some((c) => r[c] == null)) continue;
        const k = JSON.stringify(u.cols.map((c) => r[c]));
        if (seen.has(k)) throw new Fail(err("23505", `duplicate key value violates unique constraint "${u.name}"`));
        seen.add(k);
      }
    }
    for (const r of rows) {
      if (spec.tenant && !(spec.nullableTenant && r.tenant_id == null) && !this.tables.tenants.some((t) => t.id === r.tenant_id))
        throw new Fail(err("23503", `insert or update on table "${table}" violates foreign key constraint "${table}_tenant_id_fkey"`));
      for (const ref of spec.refs ?? []) {
        const [a, b] = ref.cols;
        if (r[a] == null || r[b] == null) continue;
        if (!this.tables[ref.table].some((x) => x[ref.to[0]] === r[a] && x[ref.to[1]] === r[b]))
          throw new Fail(err("23503", `insert or update on table "${table}" violates foreign key constraint "${table}_${a}_${b}_fkey"`));
      }
    }
  }
}

interface QState {
  table: string; kind: Recorded["kind"]; filters: Filter[]; orders: { col: string; asc: boolean }[];
  columns?: string; returning?: string; count?: boolean; head?: boolean; limit?: number; range?: [number, number];
  rows?: Row[]; patch?: Row; onConflict?: string; ignoreDuplicates?: boolean; single?: boolean;
}

class FakeQuery implements Query {
  private readonly db: FakeSupabase;
  private readonly s: QState;
  constructor(db: FakeSupabase, s: QState) { this.db = db; this.s = s; }
  private f(op: Op, col: string, val: unknown): Query { this.s.filters.push({ op, col, val }); return this; }
  select(columns = "*") { if (this.s.kind === "select") this.s.columns = columns; else this.s.returning = columns; return this; }
  eq(c: string, v: unknown) { return this.f("eq", c, v); }
  neq(c: string, v: unknown) { return this.f("neq", c, v); }
  in(c: string, v: readonly unknown[]) { return this.f("in", c, [...v]); }
  is(c: string, v: null | boolean) { return this.f("is", c, v); }
  lt(c: string, v: unknown) { return this.f("lt", c, v); }
  lte(c: string, v: unknown) { return this.f("lte", c, v); }
  gt(c: string, v: unknown) { return this.f("gt", c, v); }
  gte(c: string, v: unknown) { return this.f("gte", c, v); }
  like(c: string, p: string) { return this.f("like", c, p); }
  ilike(c: string, p: string) { return this.f("ilike", c, p); }
  order(col: string, o: { ascending?: boolean } = {}) { this.s.orders.push({ col, asc: o.ascending !== false }); return this; }
  limit(n: number) { this.s.limit = n; return this; }
  range(a: number, b: number) { this.s.range = [a, b]; return this; }
  maybeSingle(): PromiseLike<DbResult> { this.s.single = true; return this; }
  then<A = DbResult, B = never>(ok?: ((v: DbResult) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.exec()).then(ok, ko);
  }

  private project(r: Row, cols = "*"): Row {
    if (cols.trim() === "*") return clone(r);
    const out: Row = {};
    for (const c of cols.split(",").map((x) => x.trim()).filter(Boolean)) out[c] = clone(r[c] ?? null);
    return out;
  }
  private exec(): DbResult {
    const { db, s } = this;
    const rec: Recorded = { kind: s.kind, table: s.table, filters: clone(s.filters), columns: s.columns };
    if (s.rows) rec.rows = clone(s.rows);
    if (s.patch) rec.patch = clone(s.patch);
    db.log.push(rec);
    const forced = db.takeFailure(s.table);
    if (forced) return { data: null, error: forced };
    const table = db.tables[s.table];
    const snapshot = table.map((r) => ({ ...r }));
    try {
      for (const f of s.filters) if (f.val != null && typeof f.val !== "object") db.checkUuid(s.table, { [f.col]: f.val });
      for (const f of s.filters) if (f.op === "in") for (const v of f.val as unknown[]) db.checkUuid(s.table, { [f.col]: v });
      const match = (r: Row) => s.filters.every((f) => test(r, f));
      let out: Row[] = [];
      let affected = 0;
      if (s.kind === "select") {
        out = table.filter(match);
      } else if (s.kind === "insert" || s.kind === "upsert") {
        const spec = SCHEMA[s.table];
        const conflictCols = s.onConflict ? s.onConflict.split(",").map((c) => c.trim()) : spec.unique[0].cols;
        for (const input of s.rows ?? []) {
          db.checkUuid(s.table, input);
          const existing = s.kind === "upsert" ? table.find((r) => conflictCols.every((c) => r[c] != null && cmp(r[c], input[c]) === 0)) : undefined;
          if (existing) {
            if (s.ignoreDuplicates) continue;
            Object.assign(existing, clone(input));
            out.push(existing);
          } else {
            const row = { ...spec.defaults(), ...clone(input) };
            table.push(row);
            out.push(row);
          }
          affected++;
        }
        db.checkConstraints(s.table, table);
      } else if (s.kind === "update") {
        db.checkUuid(s.table, s.patch ?? {});
        for (const r of table.filter(match)) { Object.assign(r, clone(s.patch)); out.push(r); affected++; }
        db.checkConstraints(s.table, table);
      } else {
        const keep = table.filter((r) => !match(r));
        out = table.filter(match);
        affected = out.length;
        table.splice(0, table.length, ...keep);
      }
      if (s.kind !== "select") {
        const count = s.count ? affected : null;
        if (s.returning === undefined) return { data: null, error: null, count };
        out = out.map((r) => this.project(r, s.returning));
        return this.shape(out, count);
      }
      for (const o of [...s.orders].reverse()) out = [...out].sort((a, b) => (o.asc ? 1 : -1) * cmp(a[o.col] ?? "", b[o.col] ?? ""));
      const total = out.length;
      if (s.range) out = out.slice(s.range[0], s.range[1] + 1);
      if (s.limit !== undefined) out = out.slice(0, s.limit);
      if (s.head) return { data: null, error: null, count: s.count ? total : null };
      return this.shape(out.map((r) => this.project(r, s.columns)), s.count ? total : null);
    } catch (e) {
      table.splice(0, table.length, ...snapshot);
      if (e instanceof Fail) return { data: null, error: e.e };
      throw e;
    }
  }
  private shape(out: Row[], count: number | null): DbResult {
    if (!this.s.single) return { data: out, error: null, count };
    if (out.length > 1) return { data: null, error: err("PGRST116", "JSON object requested, multiple (or no) rows returned"), count };
    return { data: out[0] ?? null, error: null, count };
  }
}

// ---------------------------------------------------------------- RPCs (mirror the SQL in supabase/migrations)
const held = (c: Row) => {
  const st = (c.state ?? {}) as Row;
  return c.legal_hold === true || ["safety", "legal"].includes(String(c.escalation_reason ?? "")) || ["1", "true"].includes(String(st.legalHold ?? ""));
};
const requireTenant = (a: Row) => { if (!a.p_tenant || !UUID.test(String(a.p_tenant))) throw new Fail(err("22004", "tenant_required")); return String(a.p_tenant); };

const RPCS: Record<string, (db: FakeSupabase, a: Row) => unknown> = {
  // Mirrors 20261120002400_platform_tenant_overview.sql (CROSS-TENANT, service_role only).
  platform_tenant_overview(db, a) {
    const period = String(a.p_period ?? "");
    if (!/^\d{4}-\d{2}-01$/.test(period)) throw new Fail(err("22023", "invalid_period"));
    const limit = Math.min(200, Math.max(1, Number(a.p_limit ?? 50)));
    const offset = Math.max(0, Number(a.p_offset ?? 0));
    const search = String(a.p_search ?? "").trim().slice(0, 100).toLowerCase();
    const from = `${period}T00:00:00.000Z`;
    const match = (t: Row) => !search || String(t.name).toLowerCase().includes(search) || String(t.slug).toLowerCase().includes(search);
    const all = db.tables.tenants.filter(match)
      .sort((x, y) => cmp(y.created_at, x.created_at) || cmp(x.id, y.id));
    const items = all.slice(offset, offset + limit).map((t) => {
      const u = db.tables.ai_usage.find((r) => r.tenant_id === t.id && r.period === period);
      return {
        id: t.id, name: t.name, slug: t.slug, plan: t.plan, status: t.status, ai_monthly_token_cap: t.ai_monthly_token_cap, created_at: t.created_at,
        members: db.tables.tenant_members.filter((m) => m.tenant_id === t.id).length,
        conversations_this_month: db.tables.conversations.filter((c) => c.tenant_id === t.id && c.channel !== "simulator" && new Date(String(c.last_message_at)).toISOString() >= from).length,
        connected_channels: db.tables.channel_accounts.filter((c) => c.tenant_id === t.id && c.status === "connected").length,
        ai_tokens_this_month: u ? Number(u.input_tokens) + Number(u.output_tokens) : 0,
      };
    });
    return { total: all.length, items };
  },
  rate_limit_hit(db, a) {
    const key = String(a.p_key), limit = Number(a.p_limit), win = Number(a.p_window_ms), t = Number(a.p_now);
    const rows = db.tables.rate_limits;
    let r = rows.find((x) => x.key === key);
    if (!r) { r = { key, window_start: t, count: 1 }; rows.push(r); }
    else if (t - Number(r.window_start) >= win) { r.window_start = t; r.count = 1; }
    else r.count = Number(r.count) + 1;
    const ok = (r.count === 1 && r.window_start === t) || Number(r.count) <= limit;
    return { ok, retryAfterS: ok ? 0 : Math.ceil((Number(r.window_start) + win - t) / 1000) };
  },
  usage_add(db, a) {
    const tid = requireTenant(a);
    const rows = db.tables.ai_usage;
    let r = rows.find((x) => x.tenant_id === tid && x.period === a.p_period);
    if (!r) { r = { tenant_id: tid, period: a.p_period, requests: 0, input_tokens: 0, output_tokens: 0, updated_at: now() }; rows.push(r); db.checkConstraints("ai_usage", rows); }
    r.requests = Number(r.requests) + Math.max(0, Number(a.p_requests ?? 0));
    r.input_tokens = Number(r.input_tokens) + Math.max(0, Number(a.p_input_tokens ?? 0));
    r.output_tokens = Number(r.output_tokens) + Math.max(0, Number(a.p_output_tokens ?? 0));
    return { requests: r.requests, input_tokens: r.input_tokens, output_tokens: r.output_tokens };
  },
  conversation_touch(db, a) {
    const tid = requireTenant(a);
    const c = db.tables.conversations.find((x) => x.tenant_id === tid && x.id === a.p_conversation);
    if (c) {
      c.last_message_at = a.p_at ?? now();
      if (a.p_inbound) { c.last_inbound_at = a.p_at ?? now(); c.unread = Number(c.unread) + 1; }
    }
    return null;
  },
  retention_purge_tenant(db, a) {
    const tid = requireTenant(a);
    const convs = db.tables.conversations.filter((c) => c.tenant_id === tid);
    const heldIds = new Set(convs.filter(held).map((c) => c.id));
    const cutoff = String(a.p_cutoff), mask = String(a.p_mask_cutoff), body = String(a.p_masked_body);
    const before = db.tables.messages.length;
    db.tables.messages = db.tables.messages.filter((m) => !(m.tenant_id === tid && String(m.created_at) < cutoff && !heldIds.has(m.conversation_id)));
    let messagesDeleted = before - db.tables.messages.length;
    const ids = convs.filter((c) => String(c.last_message_at) < cutoff && !heldIds.has(c.id)).map((c) => String(c.id));
    const b2 = db.tables.messages.length;
    db.tables.messages = db.tables.messages.filter((m) => !(m.tenant_id === tid && ids.includes(String(m.conversation_id))));
    messagesDeleted += b2 - db.tables.messages.length;
    const b3 = db.tables.conversations.length;
    db.tables.conversations = db.tables.conversations.filter((c) => !(c.tenant_id === tid && ids.includes(String(c.id))));
    let messagesMasked = 0;
    for (const m of db.tables.messages) {
      if (m.tenant_id === tid && m.body !== body && String(m.created_at) < mask && heldIds.has(m.conversation_id)) {
        m.body = body; m.meta = { ...(m.meta as Row), masked: 1 }; messagesMasked++;
      }
    }
    return { messagesDeleted, conversationsDeleted: b3 - db.tables.conversations.length, messagesMasked, deletedConversationIds: ids };
  },
  retention_delete_conversations(db, a) {
    const tid = requireTenant(a);
    const ids = ((a.p_ids as unknown[]) ?? []).map(String);
    for (const id of ids) if (!UUID.test(id)) throw new Fail(err("22P02", "invalid input syntax for type uuid"));
    const m0 = db.tables.messages.length, c0 = db.tables.conversations.length;
    db.tables.messages = db.tables.messages.filter((m) => !(m.tenant_id === tid && ids.includes(String(m.conversation_id))));
    db.tables.engine_inbound_log = db.tables.engine_inbound_log.filter((l) => !(l.tenant_id === tid && ids.includes(String(l.conversation_id))));
    db.tables.conversations = db.tables.conversations.filter((c) => !(c.tenant_id === tid && ids.includes(String(c.id))));
    return { conversations: c0 - db.tables.conversations.length, messages: m0 - db.tables.messages.length };
  },
};

// ---------------------------------------------------------------- Storage (mirrors storage.buckets in the init migration)
export interface StorageCall { bucket: string; op: "upload" | "download" | "remove" | "list" | "publicUrl"; paths: string[] }
interface StoredObject { bytes: Uint8Array; contentType: string; updatedAt: string; createdAt: string }
const BUCKETS: Record<string, { public: boolean; limit: number; mimes: string[] }> = {
  "tenant-files": { public: false, limit: 10485760, mimes: ["application/pdf", "text/plain", "text/markdown", "text/csv", "text/html", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"] },
  "brand-assets": { public: true, limit: 2097152, mimes: ["image/png", "image/jpeg", "image/webp"] },
};
const notFound = (): StorageError => ({ message: "Object not found", statusCode: "404", status: 400 });

export class FakeStorage {
  readonly objects: Record<string, Map<string, StoredObject>> = Object.fromEntries(Object.keys(BUCKETS).map((b) => [b, new Map()]));
  readonly calls: StorageCall[] = [];
  private failures: StorageError[] = [];
  /** The next storage call fails with `error`. */
  failNext(error: StorageError) { this.failures.push(error); }

  bucket(name: string): StorageBucketApi {
    const cfg = BUCKETS[name];
    if (!cfg) throw new Error(`fake: unknown bucket ${name}`);
    const store = this.objects[name];
    const call = (op: StorageCall["op"], paths: string[]) => { this.calls.push({ bucket: name, op, paths }); return this.failures.shift() ?? null; };
    return {
      upload: async (path, body, o = {}) => {
        const forced = call("upload", [path]); if (forced) return { data: null, error: forced };
        const type = (o.contentType ?? "").split(";")[0].trim();
        if (body.byteLength > cfg.limit) return { data: null, error: { message: "The object exceeded the maximum allowed size", statusCode: "413", status: 400 } };
        if (!cfg.mimes.includes(type)) return { data: null, error: { message: `mime type ${type} is not supported`, statusCode: "415", status: 400 } };
        if (store.has(path) && !o.upsert) return { data: null, error: { message: "The resource already exists", statusCode: "409", status: 400 } };
        const at = now();
        store.set(path, { bytes: new Uint8Array(body), contentType: type, updatedAt: at, createdAt: store.get(path)?.createdAt ?? at });
        return { data: { path }, error: null };
      },
      download: async (path) => {
        const forced = call("download", [path]); if (forced) return { data: null, error: forced };
        const o = store.get(path);
        return o ? { data: new Blob([o.bytes.slice()], { type: o.contentType }), error: null } : { data: null, error: notFound() };
      },
      remove: async (paths) => {
        const forced = call("remove", paths); if (forced) return { data: null, error: forced };
        for (const p of paths) store.delete(p);
        return { data: [], error: null };
      },
      list: async (prefix = "", o = {}) => {
        const forced = call("list", [prefix]); if (forced) return { data: null, error: forced };
        const dir = prefix ? `${prefix.replace(/\/+$/, "")}/` : "";
        const out: StorageObject[] = [];
        const folders = new Set<string>();
        for (const [p, obj] of store) {
          if (!p.startsWith(dir)) continue;
          const rest = p.slice(dir.length);
          const slash = rest.indexOf("/");
          if (slash >= 0) { folders.add(rest.slice(0, slash)); continue; }
          out.push({ name: rest, id: p, updated_at: obj.updatedAt, created_at: obj.createdAt, metadata: { size: obj.bytes.byteLength, mimetype: obj.contentType } });
        }
        for (const f of folders) out.push({ name: f, id: null, metadata: null });
        let rows = out.filter((x) => !o.search || x.name.startsWith(o.search)).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
        rows = rows.slice(o.offset ?? 0, (o.offset ?? 0) + (o.limit ?? 100));
        return { data: rows, error: null };
      },
      getPublicUrl: (path) => {
        this.calls.push({ bucket: name, op: "publicUrl", paths: [path] });
        return { data: { publicUrl: `https://fake.supabase.test/storage/v1/object/public/${name}/${path}` } };
      },
    };
  }
}
