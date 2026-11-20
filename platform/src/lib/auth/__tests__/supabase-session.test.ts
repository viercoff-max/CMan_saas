// Supabase-mode session resolution with mocked clients (offline). Key rule: the active-tenant cookie is a hint only;
// a tenant id the user is not a member of is ignored, and the role always comes from the real membership.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeSupabase, hasEq } from "./fake-supabase";

const G = globalThis as { __jar?: Map<string, string>; __sets?: { name: string; value: string; opts?: unknown }[]; __client?: unknown };
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (n: string) => (G.__jar?.has(n) ? { name: n, value: G.__jar.get(n)! } : undefined),
    getAll: () => [...(G.__jar ?? new Map()).entries()].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string, opts?: unknown) => { (G.__sets ??= []).push({ name, value, opts }); G.__jar?.set(name, value); },
    delete: (n: string) => { G.__jar?.delete(n); },
  }),
  headers: async () => new Headers(),
}));
vi.mock("@/lib/auth/supabase-server", () => ({ createSupabaseServerClient: async () => G.__client }));

import { getAuthState, getSession, requireRole, requireSession, setActiveTenant } from "@/lib/auth";
import { resolveSupabaseAuth } from "../supabase-session";

const UID = "11111111-1111-4111-8111-111111111111";
const TA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FOREIGN = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function client(rows: unknown[] = [
  { tenant_id: TA, role: "agent", created_at: "2026-01-01", tenants: { name: "Aurora", status: "active" } },
  { tenant_id: TB, role: "admin", created_at: "2026-02-01", tenants: { name: "Chefman", status: "active" } },
]) {
  return fakeSupabase({
    claims: { sub: UID, email: "Owner@Example.test", user_metadata: { name: "Mariana" } },
    results: { "tenant_members.select": { data: rows, error: null } },
  });
}

beforeEach(() => { process.env.DATA_BACKEND = "supabase"; G.__jar = new Map(); G.__sets = []; });
afterEach(() => { delete process.env.DATA_BACKEND; G.__client = undefined; });

describe("resolveSupabaseAuth", () => {
  it("reads memberships with the user's own id filter (RLS client) and builds the session", async () => {
    const f = client();
    const st = await resolveSupabaseAuth(f.client, TB);
    expect(st).toEqual({
      status: "ok",
      session: {
        userId: UID, tenantId: TB, role: "admin", name: "Mariana", email: "owner@example.test",
        tenants: [{ id: TA, name: "Aurora", role: "agent" }, { id: TB, name: "Chefman", role: "admin" }],
      },
    });
    const q = f.calls.find((c) => c.table === "tenant_members")!;
    expect(hasEq(q, "user_id", UID)).toBe(true);
  });

  it("CROSS-TENANT: a forged active-tenant cookie is ignored (first real membership, its own role)", async () => {
    const st = await resolveSupabaseAuth(client().client, FOREIGN);
    expect(st.status === "ok" && [st.session.tenantId, st.session.role]).toEqual([TA, "agent"]);
  });

  it("no session -> anonymous; no membership -> no_tenant; deleted tenants and bad roles are skipped", async () => {
    expect(await resolveSupabaseAuth(fakeSupabase({ claims: null }).client, TA)).toEqual({ status: "anonymous" });
    const none = await resolveSupabaseAuth(client([]).client, TA);
    expect(none.status).toBe("no_tenant");
    const junk = await resolveSupabaseAuth(client([
      { tenant_id: TA, role: "owner", tenants: { name: "Gone", status: "deleted" } },
      { tenant_id: TB, role: "superadmin", tenants: { name: "X", status: "active" } },
    ]).client, TA);
    expect(junk.status).toBe("no_tenant");
  });

  it("fails closed when the membership query errors", async () => {
    const f = fakeSupabase({ claims: { sub: UID, email: "a@b.test" }, results: { "tenant_members.select": { data: null, error: { message: "boom" } } } });
    await expect(resolveSupabaseAuth(f.client, TA)).rejects.toThrow("membership_lookup_failed");
  });
});

describe("getSession / requireRole / setActiveTenant (DATA_BACKEND=supabase)", () => {
  it("uses the active_tenant cookie only when it is a membership", async () => {
    G.__client = client().client;
    G.__jar!.set("active_tenant", TB);
    expect((await getSession())?.tenantId).toBe(TB);
    G.__jar!.set("active_tenant", FOREIGN);
    expect((await getSession())?.tenantId).toBe(TA);
  });

  it("agent in the active tenant gets 403 from requireRole('admin'); admin passes", async () => {
    G.__client = client().client;
    G.__jar!.set("active_tenant", TA); // agent here
    const err = await requireRole("admin").catch((e) => e);
    expect(err).toBeInstanceOf(Response);
    expect((err as Response).status).toBe(403);
    expect((await requireSession()).tenantId).toBe(TA); // still a member: inbox works
    G.__jar!.set("active_tenant", TB); // admin here
    expect((await requireRole("admin")).tenantId).toBe(TB);
  });

  it("anonymous -> 401; signed in without tenant -> no_tenant state (layout sends to /onboarding)", async () => {
    G.__client = fakeSupabase({ claims: null }).client;
    expect(((await requireSession().catch((e) => e)) as Response).status).toBe(401);
    G.__client = client([]).client;
    expect((await getAuthState()).status).toBe("no_tenant");
    expect(await getSession()).toBeNull();
  });

  it("setActiveTenant refuses a tenant the user does not belong to (no cookie written)", async () => {
    G.__client = client().client;
    expect(await setActiveTenant(FOREIGN)).toBe(false);
    expect(await setActiveTenant(123)).toBe(false);
    expect(G.__sets).toEqual([]);
    expect(await setActiveTenant(TB)).toBe(true);
    expect(G.__sets).toEqual([expect.objectContaining({ name: "active_tenant", value: TB, opts: expect.objectContaining({ httpOnly: true, sameSite: "lax" }) })]);
  });
});

// L1 (REVIEW-security-2): suspended / deleted tenants give no app access.
describe("tenant status in session resolution", () => {
  it("suspended tenants are dropped; only-suspended users get no_tenant + suspended (no onboarding)", async () => {
    const mixed = await resolveSupabaseAuth(client([
      { tenant_id: TA, role: "owner", tenants: { name: "Suspendida", status: "suspended" } },
      { tenant_id: TB, role: "agent", tenants: { name: "Activa", status: "active" } },
    ]).client, TA); // cookie names the suspended tenant: ignored
    expect(mixed.status === "ok" && [mixed.session.tenantId, mixed.session.tenants.map((t) => t.id)]).toEqual([TB, [TB]]);
    const only = await resolveSupabaseAuth(client([
      { tenant_id: TA, role: "owner", tenants: { name: "Suspendida", status: "suspended" } },
    ]).client, TA);
    expect(only).toMatchObject({ status: "no_tenant", suspended: true });
    const deleted = await resolveSupabaseAuth(client([
      { tenant_id: TA, role: "owner", tenants: { name: "Borrada", status: "deleted" } },
    ]).client, TA);
    expect(deleted.status).toBe("no_tenant");
    expect("suspended" in deleted && deleted.suspended).toBeFalsy();
  });
});
