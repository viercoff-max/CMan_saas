// Role gating with the REAL auth.ts in sqlite mode: an agent gets 403 on every admin-only mutation (tone, context,
// sources, uploads, channels, Shopify add-on, team) and keeps the inbox/simulator. Admins are unaffected.
import "./setup";
import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { vi } from "vitest";

vi.mock("next/headers", async () => (await import("./mocks")).headersMock());
vi.mock("next/cache", async () => (await import("./mocks")).cacheMock());

import { getDb } from "@/lib/db";
import { sign } from "@/lib/crypto";
import { hashPassword, getSession } from "@/lib/auth";
import { getData } from "@/lib/data";
import { CONTEXT_SECTION_KEYS } from "@/lib/types";
import { saveToneAction } from "@/app/(app)/tone/actions";
import { addSectionLinkAction, removeSectionFileAction, saveContextAction, setSectionSourceAction } from "@/app/(app)/context/actions";
import { addLinkAction, deleteSourceAction, syncSourceAction } from "@/app/(app)/sources/actions";
import { connectChannel, disconnectChannel } from "@/app/(app)/channels/actions";
import { changeRoleAction, inviteMemberAction, removeMemberAction, revokeInviteAction } from "@/app/(app)/team/actions";
import { POST as uploadPOST } from "@/app/api/sources/upload/route";
import { POST as sectionFilePOST } from "@/app/api/context/section-file/route";
import { POST as shopifyConnect } from "@/app/api/shopify/connect/route";
import { POST as shopifyDisconnect } from "@/app/api/shopify/disconnect/route";
import { POST as shopifyManual } from "@/app/api/shopify/manual/route";
import { POST as shopifyDemo } from "@/app/api/shopify/demo/route";
import { POST as simulatePOST } from "@/app/api/inbox/simulate/route";
import { asUser, jsonReq, newTenant, type TestTenant } from "./helpers";

afterEach(() => asUser(null));

async function addUser(tenantId: string, role: "agent" | "admin" | "owner"): Promise<TestTenant> {
  const userId = randomUUID();
  getDb().prepare("INSERT INTO users (id, tenant_id, email, name, password_hash, role) VALUES (?,?,?,?,?,?)")
    .run(userId, tenantId, `${role}-${userId}@example.test`, role, hashPassword("not-a-real-password"), role);
  const payload = `${userId}.${tenantId}.${Date.now() + 3_600_000}`;
  return { tenantId, userId, cookie: `${payload}.${sign(payload)}` };
}

const thrownStatus = async (p: Promise<unknown>) => {
  const e = await p.then(() => null, (err) => err);
  expect(e, "expected a thrown Response").toBeInstanceOf(Response);
  return (e as Response).status;
};

const tone = { agentName: "Chefi", toneLevel: 3, languageDefault: "es", greeting: "", fallbackMessage: "", handoffEmail: "", crossSellLevel: 0, hours: { fromDay: 1, toDay: 5, open: "09:00", close: "18:00", timezone: "America/Mexico_City" } };
const sections = Object.fromEntries(CONTEXT_SECTION_KEYS.map((k) => [k, "texto"]));
const SRC = "00000000-0000-4000-8000-000000000001";

describe("role gating (agent = inbox + simulator only)", () => {
  it("session carries the role and a single-tenant list in sqlite mode", async () => {
    const t = await newTenant("Roles");
    const agent = await addUser(t.tenantId, "agent");
    asUser(agent);
    expect(await getSession()).toMatchObject({ userId: agent.userId, tenantId: t.tenantId, role: "agent", tenants: [{ id: t.tenantId, name: "Roles", role: "agent" }] });
    asUser(t);
    expect((await getSession())?.role).toBe("admin"); // existing users default to admin
  });

  it("agent: 403 on every admin server action, nothing is written", async () => {
    const t = await newTenant();
    asUser(await addUser(t.tenantId, "agent"));
    expect(await thrownStatus(saveToneAction(tone))).toBe(403);
    expect(await thrownStatus(saveContextAction({ sections }))).toBe(403);
    expect(await thrownStatus(removeSectionFileAction({ key: "warranty" }))).toBe(403);
    expect(await thrownStatus(setSectionSourceAction({ key: "warranty", sourceId: SRC, linked: true }))).toBe(403);
    expect(await thrownStatus(addSectionLinkAction({ key: "warranty", url: "https://example.test/a" }))).toBe(403);
    expect(await thrownStatus(addLinkAction({ url: "https://example.test/a" }))).toBe(403);
    expect(await thrownStatus(syncSourceAction({ id: SRC }))).toBe(403);
    expect(await thrownStatus(deleteSourceAction({ id: SRC }))).toBe(403);
    expect(await thrownStatus(connectChannel("whatsapp", { externalId: "5551234", accessToken: "EAAG-token-123456", wabaId: "WABA1" }))).toBe(403);
    expect(await thrownStatus(disconnectChannel("whatsapp"))).toBe(403);
    expect(await thrownStatus(inviteMemberAction({ email: "x@example.test", role: "agent" }))).toBe(403);
    expect(await thrownStatus(changeRoleAction({ userId: SRC, role: "admin" }))).toBe(403);
    expect(await thrownStatus(removeMemberAction({ userId: SRC }))).toBe(403);
    expect(await thrownStatus(revokeInviteAction({ id: SRC }))).toBe(403);

    expect(await getData().settings.isToneSaved(t.tenantId)).toBe(false);
    expect((await getData().sections.list(t.tenantId)).every((s) => s.content === "")).toBe(true);
    expect(await getData().sources.list(t.tenantId)).toHaveLength(0);
  });

  it("agent: 403 on admin route handlers (uploads, Shopify connect/disconnect/manual/demo)", async () => {
    const t = await newTenant();
    asUser(await addUser(t.tenantId, "agent"));
    const base = "https://inbox.test";
    expect((await uploadPOST(jsonReq(`${base}/api/sources/upload`, {}))).status).toBe(403);
    expect((await sectionFilePOST(jsonReq(`${base}/api/context/section-file`, {}))).status).toBe(403);
    expect((await shopifyConnect(jsonReq(`${base}/api/shopify/connect`, { shop: "x.myshopify.com" }))).status).toBe(403);
    expect((await shopifyDisconnect(jsonReq(`${base}/api/shopify/disconnect`, {}))).status).toBe(403);
    expect((await shopifyManual(jsonReq(`${base}/api/shopify/manual`, { shop: "x.myshopify.com", token: "shpat_1234567890" }))).status).toBe(403);
    expect((await shopifyDemo(jsonReq(`${base}/api/shopify/demo`, {}))).status).toBe(403);
    expect((await getData().addons.get(t.tenantId, "shopify")).status).not.toBe("connected");
  });

  it("agent keeps the simulator; admin and owner keep admin actions", async () => {
    const t = await newTenant();
    asUser(await addUser(t.tenantId, "agent"));
    expect((await simulatePOST(jsonReq("https://inbox.test/api/inbox/simulate", { text: "hola" }))).status).toBe(200);

    asUser(t); // admin
    expect((await shopifyDemo(jsonReq("https://inbox.test/api/shopify/demo", {}))).status).toBe(200);
    expect((await saveToneAction(tone)).ok).toBe(true);
    asUser(await addUser(t.tenantId, "owner"));
    expect((await shopifyDisconnect(jsonReq("https://inbox.test/api/shopify/disconnect", {}))).status).toBe(200);
    // team management needs Supabase: admins get a clean "unsupported", not a crash
    expect(await inviteMemberAction({ email: "x@example.test", role: "agent" })).toEqual({ ok: false, error: "unsupported" });
  });

  it("anonymous: 401 on admin routes, before the role check", async () => {
    asUser(null);
    expect((await shopifyDemo(jsonReq("https://inbox.test/api/shopify/demo", {}))).status).toBe(401);
    expect(await thrownStatus(saveToneAction(tone))).toBe(401);
  });

  it("CROSS-TENANT: an admin of tenant B is still only acting on B (role check is per active tenant)", async () => {
    const a = await newTenant("A"), b = await newTenant("B");
    asUser(await addUser(a.tenantId, "agent"));
    expect(await thrownStatus(saveToneAction(tone))).toBe(403);
    asUser(b);
    expect((await saveToneAction(tone)).ok).toBe(true);
    expect(await getData().settings.isToneSaved(b.tenantId)).toBe(true);
    expect(await getData().settings.isToneSaved(a.tenantId)).toBe(false);
  });
});
