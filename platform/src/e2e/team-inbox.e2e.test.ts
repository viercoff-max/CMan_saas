// Phase 1 "atención en equipo" through the real route handlers (SQLite e2e harness, no network):
//  - assign to me / to a teammate / unassign, with an activity entry; a member of ANOTHER tenant is refused;
//  - status pending / waiting_customer: the bot stays silent; a customer answer on "waiting" goes back to "human";
//  - internal notes: add, list in the thread, only the author deletes; never sent to the customer;
//  - cross-tenant negatives: another tenant can neither read, assign, annotate nor change status.
import "./setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("./mocks")).headersMock());

import { POST as assignPOST } from "@/app/api/inbox/conversations/[id]/assign/route";
import { POST as statusPOST } from "@/app/api/inbox/conversations/[id]/status/route";
import { POST as notePOST, DELETE as noteDELETE } from "@/app/api/inbox/conversations/[id]/notes/route";
import { GET as threadGET } from "@/app/api/inbox/conversations/[id]/messages/route";
import { GET as listGET } from "@/app/api/inbox/conversations/route";
import { handleInbound } from "@/lib/engine";
import { getData } from "@/lib/data";
import { asUser, jsonReq, newTenant, routeCtx, seedContext, stubFetch, type TestTenant } from "./helpers";

let A: TestTenant, B: TestTenant;
const url = (id: string, p: string) => `https://inbox.test/api/inbox/conversations/${id}/${p}`;
const assign = (id: string, userId: string | null) => assignPOST(jsonReq(url(id, "assign"), { userId }), routeCtx(id));
const status = (id: string, action: string) => statusPOST(jsonReq(url(id, "status"), { action }), routeCtx(id));
const addNote = (id: string, body: string) => notePOST(jsonReq(url(id, "notes"), { body }), routeCtx(id));
const thread = async (id: string) => (await threadGET(new Request(url(id, "messages")), routeCtx(id)));

async function conv(tenantId: string, ext = "555") {
  const c = await getData().conversations.getOrCreate(tenantId, "telegram", ext, "Cliente");
  await getData().messages.add(tenantId, c.id, { direction: "in", sender: "customer", body: "hola" });
  await getData().conversations.setStatus(tenantId, c.id, "needs_human", "human_request");
  return c.id;
}

beforeEach(async () => { A = await newTenant("TiendaA"); B = await newTenant("TiendaB"); asUser(A); });
afterEach(() => { vi.unstubAllGlobals(); asUser(null); });

describe("assignment", () => {
  it("assign to me, list 'mine' / 'unassigned', unassign; every change is in the activity log", async () => {
    const id = await conv(A.tenantId);
    const other = await conv(A.tenantId, "556");
    expect((await assign(id, "me")).status).toBe(200);
    expect((await getData().conversations.get(A.tenantId, id))?.assignedTo).toBe(A.userId);
    const mine = await (await listGET(new Request("https://inbox.test/api/inbox/conversations?assigned=mine"))).json();
    expect(mine.conversations.map((c: { id: string }) => c.id)).toEqual([id]);
    const none = await (await listGET(new Request("https://inbox.test/api/inbox/conversations?assigned=none"))).json();
    expect(none.conversations.map((c: { id: string }) => c.id)).toEqual([other]);
    expect((await assign(id, null)).status).toBe(200);
    const t = await (await thread(id)).json();
    expect(t.events.map((e: { kind: string }) => e.kind)).toEqual(["assigned", "unassigned"]);
    expect(t.team.some((m: { userId: string }) => m.userId === A.userId)).toBe(true);
  });

  it("cross-tenant negative: a member of tenant B cannot be assigned in A; B cannot assign A's conversation", async () => {
    const id = await conv(A.tenantId);
    const r = await assign(id, B.userId);
    expect(r.status).toBe(400);
    expect(await r.json()).toEqual({ error: "not_member" });
    expect((await getData().conversations.get(A.tenantId, id))?.assignedTo ?? null).toBeNull();
    asUser(B);
    expect((await assign(id, "me")).status).toBe(404);
    expect((await thread(id)).status).toBe(404);
    expect((await addNote(id, "hack")).status).toBe(404);
    expect((await status(id, "resolve")).status).toBe(404);
    asUser(A);
    expect((await getData().conversations.get(A.tenantId, id))?.status).toBe("needs_human");
    expect(await getData().notes.list(A.tenantId, id)).toEqual([]);
  });
});

describe("statuses: pending and waiting_customer", () => {
  it("the bot stays silent on pending; a customer answer on 'waiting' returns it to the team", async () => {
    await seedContext(A.tenantId);
    const net = stubFetch();
    const id = await conv(A.tenantId);
    expect((await status(id, "pending")).status).toBe(200);
    const r1 = await handleInbound({ tenantId: A.tenantId, channel: "telegram", externalId: "555", text: "¿cuánto dura la garantía?" });
    expect(r1.text).toBe("");
    expect((await getData().conversations.get(A.tenantId, id))?.status).toBe("pending");
    expect((await status(id, "waiting")).status).toBe(200);
    const r2 = await handleInbound({ tenantId: A.tenantId, channel: "telegram", externalId: "555", text: "ya te mandé la foto" });
    expect(r2.text).toBe("");
    expect((await getData().conversations.get(A.tenantId, id))?.status).toBe("human");
    expect(net.calls).toHaveLength(0); // no AI, no channel send
    const kinds = (await getData().events.list(A.tenantId, id)).map((e) => `${e.kind}:${String(e.detail.to ?? "")}`);
    expect(kinds).toEqual(["status:pending", "status:waiting_customer", "status:human"]);
  });

  it("an unknown action is refused", async () => {
    const id = await conv(A.tenantId);
    expect((await status(id, "snooze")).status).toBe(400);
  });
});

describe("internal notes", () => {
  it("add, show in the thread, only the author deletes; nothing is sent", async () => {
    const net = stubFetch();
    const id = await conv(A.tenantId);
    const r = await addNote(id, "Llamar mañana a las 10");
    expect(r.status).toBe(200);
    const { note } = await r.json();
    const t = await (await thread(id)).json();
    expect(t.notes.map((n: { body: string }) => n.body)).toEqual(["Llamar mañana a las 10"]);
    expect(t.messages.some((m: { body: string }) => m.body.includes("Llamar"))).toBe(false); // never a message
    expect(net.calls).toHaveLength(0);
    const del = (noteId: string) => noteDELETE(new Request(`${url(id, "notes")}?note=${noteId}`, { method: "DELETE", headers: { origin: "https://inbox.test" } }), routeCtx(id));
    const peer = await newTenant("Otra");
    asUser(peer);
    expect((await del(note.id)).status).toBe(404); // another tenant
    asUser(A);
    expect((await del(note.id)).status).toBe(200);
    expect(await getData().notes.list(A.tenantId, id)).toEqual([]);
  });

  it("empty or oversized notes are refused", async () => {
    const id = await conv(A.tenantId);
    expect((await addNote(id, "   ")).status).toBe(400);
    expect((await addNote(id, "x".repeat(4001))).status).toBe(400);
  });
});
