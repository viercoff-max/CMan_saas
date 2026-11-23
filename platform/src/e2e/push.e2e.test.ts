// Phase 2 notices through the real pipeline (SQLite e2e harness, push services mocked):
//  - a handoff notifies every member who wants it, on their devices, with NO customer data in the notice;
//  - urgent (safety) uses the "urgent" preference; preferences off -> no notice; simulator -> nothing;
//  - assignment notifies the assignee only (not the person who assigned);
//  - a device the push service reports gone (410) is removed;
//  - routes: subscribe refuses non push-service endpoints; /latest returns only the person's own notice;
//  - cross-tenant: another business's devices and notices are never used.
import "./setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("./mocks")).headersMock());

import { POST as subscribePOST } from "@/app/api/push/subscribe/route";
import { GET as latestGET } from "@/app/api/push/latest/route";
import { getData } from "@/lib/data";
import { notifyAssigned, notifyHandoff } from "@/lib/push/notify";
import { asUser, jsonReq, newTenant, type TestTenant } from "./helpers";

let A: TestTenant, B: TestTenant;
let seq = 0;
const ep = () => `https://fcm.googleapis.com/fcm/send/device-${++seq}-abcdefgh`;
function stubPush(status = 201) {
  const hits: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (!String(url).startsWith("https://fcm.googleapis.com/")) throw new Error("unexpected network call");
    hits.push(String(url)); return new Response(null, { status });
  }));
  return hits;
}

beforeEach(async () => { A = await newTenant("TiendaA"); B = await newTenant("TiendaB"); });
afterEach(() => { vi.unstubAllGlobals(); asUser(null); });

describe("handoff and assignment notices", () => {
  it("handoff: members' devices get a push; the notice has no customer name or text", async () => {
    const d = getData();
    const dev = ep();
    await d.push.subscribe(A.tenantId, A.userId, dev, "Mozilla/5.0 (Android) Chrome/130");
    const other = ep();
    await d.push.subscribe(B.tenantId, B.userId, other, "x"); // another business: never used
    const c = await d.conversations.getOrCreate(A.tenantId, "telegram", "555", "Ana Secreta");
    const hits = stubPush();
    await notifyHandoff(A.tenantId, c.id, "telegram", "safety");
    expect(hits).toEqual([dev]);
    const [n] = await d.push.latestNotices(A.userId, "2000-01-01T00:00:00.000Z");
    expect(n).toMatchObject({ kind: "urgent", url: `/inbox?c=${c.id}` });
    expect(`${n.title} ${n.body}`).not.toContain("Ana");
    expect(n.body).toContain("Telegram");
    expect(await d.push.latestNotices(B.userId, "2000-01-01T00:00:00.000Z")).toEqual([]);
  });

  it("preferences off -> no notice; simulator handoffs never notify", async () => {
    const d = getData();
    await d.push.subscribe(A.tenantId, A.userId, ep(), "x");
    await d.push.savePrefs(A.tenantId, A.userId, { waiting: false, urgent: true, assigned: true });
    const c = await d.conversations.getOrCreate(A.tenantId, "telegram", "556");
    const hits = stubPush();
    await notifyHandoff(A.tenantId, c.id, "telegram", "human_request");
    await notifyHandoff(A.tenantId, c.id, "simulator", "safety");
    expect(hits).toEqual([]);
    expect(await d.push.latestNotices(A.userId, "2000-01-01T00:00:00.000Z")).toEqual([]);
  });

  it("assignment notifies the assignee only; a 410 device is removed", async () => {
    const d = getData();
    const dev = ep();
    await d.push.subscribe(A.tenantId, A.userId, dev, "x");
    const c = await d.conversations.getOrCreate(A.tenantId, "telegram", "557");
    let hits = stubPush(410);
    await notifyAssigned(A.tenantId, c.id, A.userId, "someone-else");
    expect(hits).toEqual([dev]);
    expect(await d.push.listDevices(A.tenantId, A.userId)).toEqual([]); // gone -> removed
    hits = stubPush();
    await notifyAssigned(A.tenantId, c.id, A.userId, A.userId); // self-assign: nothing
    expect(hits).toEqual([]);
  });
});

describe("push routes", () => {
  it("subscribe accepts only browser push services; latest returns the person's own newest notice", async () => {
    asUser(A);
    const bad = await subscribePOST(jsonReq("https://inbox.test/api/push/subscribe", { endpoint: "https://evil.example.com/collect/abcdef" }));
    expect(bad.status).toBe(400);
    const okEp = ep();
    expect((await subscribePOST(jsonReq("https://inbox.test/api/push/subscribe", { endpoint: okEp }))).status).toBe(200);
    expect((await getData().push.listDevices(A.tenantId, A.userId)).map((x) => x.endpoint)).toEqual([okEp]);
    await getData().push.addNotice(B.tenantId, B.userId, { kind: "waiting", title: "de B", body: "", url: "/inbox" });
    expect((await (await latestGET()).json()).notice).toBeNull(); // B's notice is not A's
    await getData().push.addNotice(A.tenantId, A.userId, { kind: "waiting", title: "Un cliente necesita a una persona", body: "TiendaA", url: "/inbox" });
    expect((await (await latestGET()).json()).notice).toMatchObject({ title: "Un cliente necesita a una persona", url: "/inbox" });
  });
});
