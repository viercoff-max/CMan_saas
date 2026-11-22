// REVIEW-qa-2 P1-2 / P1-6 / P2-1 / P2-11 through the real inbox route handlers:
//  - replying to a seeded demo conversation stores the agent reply and takes it over, with NO network call;
//  - a real conversation on a channel that is not connected answers 409 (not 502) and stores nothing;
//  - the list API, the dashboard and the sidebar read ONE counts loader (urgent safety/legal cases counted apart);
//  - cross-tenant negatives: another tenant can neither reply to nor count these conversations.
import "./setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("./mocks")).headersMock());

import { POST as replyPOST } from "@/app/api/inbox/conversations/[id]/reply/route";
import { GET as listGET } from "@/app/api/inbox/conversations/route";
import { loadInboxCounts } from "@/app/(app)/inbox/counts";
import { getData } from "@/lib/data";
import { asUser, jsonReq, newTenant, routeCtx, stubFetch, type TestTenant } from "./helpers";

let t: TestTenant;
const reply = (id: string, text: string) => replyPOST(jsonReq(`https://inbox.test/api/inbox/conversations/${id}/reply`, { text }), routeCtx(id));
const list = async () => (await listGET(new Request("https://inbox.test/api/inbox/conversations"))).json();

async function demoConv(tenantId: string, key: string, status: "needs_human" | "bot" = "needs_human", reason: string | null = "human_request") {
  const d = getData();
  const c = await d.conversations.getOrCreate(tenantId, "telegram", `demo-${key}`, `Demo ${key}`);
  await d.messages.add(tenantId, c.id, { direction: "in", sender: "customer", body: "hola", meta: { demo: true } });
  await d.conversations.setState(tenantId, c.id, { demo: true });
  await d.conversations.setStatus(tenantId, c.id, status, reason);
  return c.id;
}

beforeEach(async () => { t = await newTenant(); asUser(t); });
afterEach(() => { vi.unstubAllGlobals(); asUser(null); });

describe("inbox: demo conversations and send failures", () => {
  it("demo conversation: reply is stored, conversation taken over, nothing sent (no 502)", async () => {
    const net = stubFetch();
    const id = await demoConv(t.tenantId, "andrea", "needs_human", "safety");
    const res = await reply(id, "Hola Andrea, soy del equipo.");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, demo: true });
    expect(net.calls).toHaveLength(0); // never reaches Telegram / Meta
    const msgs = await getData().messages.list(t.tenantId, id);
    expect(msgs.at(-1)).toMatchObject({ sender: "agent", body: "Hola Andrea, soy del equipo.", meta: { demo: true, notSent: true } });
    expect((await getData().conversations.get(t.tenantId, id))!.status).toBe("human");
  });

  it("real conversation on a channel that is not connected -> 409, nothing stored", async () => {
    const net = stubFetch();
    const d = getData();
    const c = await d.conversations.getOrCreate(t.tenantId, "telegram", "777000111", "Cliente real");
    await d.messages.add(t.tenantId, c.id, { direction: "in", sender: "customer", body: "hola" });
    const before = (await d.messages.list(t.tenantId, c.id)).length;
    const res = await reply(c.id, "Hola");
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "send_failed", detail: "channel_not_connected" });
    expect(await d.messages.list(t.tenantId, c.id)).toHaveLength(before);
    expect(net.calls).toHaveLength(0);
  });

  it("cross-tenant: another tenant cannot reply to a demo conversation", async () => {
    stubFetch();
    const id = await demoConv(t.tenantId, "pablo");
    const other = await newTenant("Otra marca");
    asUser(other);
    expect((await reply(id, "hola")).status).toBe(404);
    expect(await getData().messages.list(t.tenantId, id)).toHaveLength(1);
  });
});

describe("inbox: one source of truth for waiting / urgent counts", () => {
  it("list API, counts loader agree; urgent = waiting safety/legal; simulator excluded; urgent sorted data flagged", async () => {
    const d = getData();
    await demoConv(t.tenantId, "a", "needs_human", "safety");
    await demoConv(t.tenantId, "b", "needs_human", "legal");
    await demoConv(t.tenantId, "c", "needs_human", "human_request");
    await demoConv(t.tenantId, "d", "bot", null);
    const sim = await d.conversations.getOrCreate(t.tenantId, "simulator", "sim-1", "Prueba");
    await d.conversations.setStatus(t.tenantId, sim.id, "needs_human", "safety");

    const loaded = await loadInboxCounts(t.tenantId);
    expect(loaded.counts.needs_human).toBe(3);
    expect(loaded.urgent).toBe(2);
    const api = await list();
    expect(api.counts).toEqual(loaded.counts);
    expect(api.urgent).toBe(2);
    const urgentNames = api.conversations.filter((c: { urgent: boolean }) => c.urgent).map((c: { customerName: string }) => c.customerName).sort();
    expect(urgentNames).toEqual(["Demo a", "Demo b"]);
    expect(api.conversations.every((c: { demo: boolean }) => c.demo)).toBe(true);

    // cross-tenant negative: another tenant sees none of it
    const other = await newTenant("Otra marca");
    expect(await loadInboxCounts(other.tenantId)).toEqual({ counts: { bot: 0, needs_human: 0, human: 0, pending: 0, waiting_customer: 0, resolved: 0 }, urgent: 0 });
    asUser(other);
    const otherApi = await list();
    expect(otherApi.conversations).toHaveLength(0);
    expect(otherApi.urgent).toBe(0);
  });
});
