// createInvitation: admin check with the USER session first, service role only for the insert, hash-only storage.
import { describe, expect, it, vi } from "vitest";
import { createInvitation } from "../invitations";
import { hashInviteToken } from "../invite-token";
import { acceptInvite, changeMemberRole, createTenant, removeMember } from "../team";
import { fakeSupabase, hasEq } from "./fake-supabase";

const UID = "11111111-1111-4111-8111-111111111111";
const TA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const TB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

/** User is admin of TA only (RLS returns no row for TB). */
function userClient(role = "admin") {
  return fakeSupabase({
    claims: { sub: UID, email: "admin@example.test" },
    results: { "tenant_members.select": (c) => ({ data: hasEq(c, "tenant_id", TA) && hasEq(c, "user_id", UID) ? [{ role }] : [], error: null }) },
  });
}

describe("createInvitation", () => {
  it("admin: stores only the SHA-256 hash and returns the plain link once", async () => {
    const u = userClient();
    const svc = fakeSupabase({ results: { "invitations.insert": { data: null, error: null } } });
    const factory = vi.fn(() => svc.client);
    const r = await createInvitation({ userClient: u.client, serviceClient: factory, baseUrl: "https://app.example/" }, { tenantId: TA, email: " Ana@Example.test ", role: "agent" });
    expect(r.ok).toBe(true);
    const link = (r as { link: string }).link;
    expect(link).toMatch(/^https:\/\/app\.example\/auth\/invite\?token=[A-Za-z0-9_-]{43}$/);
    const token = new URL(link).searchParams.get("token")!;
    const ins = svc.calls.find((c) => c.table === "invitations" && c.op === "insert")!;
    expect(ins.args[0]).toEqual({ tenant_id: TA, email: "ana@example.test", role: "agent", token_hash: hashInviteToken(token), invited_by: UID });
    expect(JSON.stringify(ins.args)).not.toContain(token);
    // older pending invitations for the same email were revoked with the USER client (RLS)
    const del = u.calls.find((c) => c.table === "invitations" && c.op === "delete")!;
    expect(hasEq(del, "tenant_id", TA) && hasEq(del, "email", "ana@example.test")).toBe(true);
  });

  it("agent: forbidden, the service client is never created", async () => {
    const factory = vi.fn();
    const r = await createInvitation({ userClient: userClient("agent").client, serviceClient: factory, baseUrl: "https://x" }, { tenantId: TA, email: "a@b.test", role: "agent" });
    expect(r).toEqual({ ok: false, error: "forbidden" });
    expect(factory).not.toHaveBeenCalled();
  });

  it("CROSS-TENANT: admin of A cannot invite into B", async () => {
    const factory = vi.fn();
    const r = await createInvitation({ userClient: userClient().client, serviceClient: factory, baseUrl: "https://x" }, { tenantId: TB, email: "a@b.test", role: "admin" });
    expect(r).toEqual({ ok: false, error: "forbidden" });
    expect(factory).not.toHaveBeenCalled();
  });

  it("rejects bad email / role / anonymous before touching the database", async () => {
    const factory = vi.fn();
    const deps = { userClient: userClient().client, serviceClient: factory, baseUrl: "https://x" };
    expect(await createInvitation(deps, { tenantId: TA, email: "nope", role: "agent" })).toEqual({ ok: false, error: "invalid" });
    expect(await createInvitation(deps, { tenantId: TA, email: "a@b.test", role: "owner" })).toEqual({ ok: false, error: "invalid" });
    const anon = { ...deps, userClient: fakeSupabase({ claims: null }).client };
    expect(await createInvitation(anon, { tenantId: TA, email: "a@b.test", role: "agent" })).toEqual({ ok: false, error: "forbidden" });
    expect(factory).not.toHaveBeenCalled();
  });

  it("insert failure -> generic error, no link", async () => {
    const svc = fakeSupabase({ results: { "invitations.insert": { data: null, error: { code: "23514", message: "check" } } } });
    expect(await createInvitation({ userClient: userClient().client, serviceClient: () => svc.client, baseUrl: "https://x" }, { tenantId: TA, email: "a@b.test", role: "agent" }))
      .toEqual({ ok: false, error: "failed" });
  });
});

describe("team helpers (user-session client)", () => {
  it("role change / removal never target the owner row and are scoped to the tenant", async () => {
    const f = fakeSupabase({ results: { "tenant_members.update": { data: [{ user_id: "u2" }], error: null }, "tenant_members.delete": { data: [], error: null } } });
    expect(await changeMemberRole(f.client, TA, "u2", "admin")).toBe(true);
    expect(await removeMember(f.client, TA, "u2")).toBe(false); // RLS returned no row
    for (const c of f.calls) {
      expect(hasEq(c, "tenant_id", TA)).toBe(true);
      expect(c.chain.some(([m, a, b]) => m === "neq" && a === "role" && b === "owner")).toBe(true);
    }
  });

  it("RPC wrappers map results without leaking details", async () => {
    const ok = fakeSupabase({ rpc: { create_tenant: { data: TA, error: null }, accept_invitation: { data: TA, error: null } } });
    expect(await createTenant(ok.client, "Café", "cafe")).toEqual({ ok: true, tenantId: TA });
    expect(ok.rpcCalls[0]).toEqual({ fn: "create_tenant", args: { p_name: "Café", p_slug: "cafe" } });
    expect(await acceptInvite(ok.client, "tok")).toEqual({ ok: true, tenantId: TA });
    const taken = fakeSupabase({ rpc: { create_tenant: { data: null, error: { code: "23505", message: "duplicate key" } }, accept_invitation: { data: null, error: { code: "P0001", message: "invitation_invalid" } } } });
    expect(await createTenant(taken.client, "Café", "cafe")).toEqual({ ok: false, error: "slug_taken" });
    expect(await acceptInvite(taken.client, "tok")).toEqual({ ok: false });
    const limit = fakeSupabase({ rpc: { create_tenant: { data: null, error: { code: "P0001", message: "tenant_limit_reached" } } } });
    expect(await createTenant(limit.client, "x", "xx")).toEqual({ ok: false, error: "limit" });
  });
});
