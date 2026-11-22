// ManyChat connect / rotate / disconnect (server actions, REAL auth + SQLite e2e harness, ManyChat API mocked).
import "@/e2e/setup";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("@/e2e/mocks")).headersMock());
vi.mock("next/cache", async () => (await import("@/e2e/mocks")).cacheMock());

import { getData } from "@/lib/data";
import { asUser, newTenant, type TestTenant } from "@/e2e/helpers";
import { connectManychat, disconnectManychat, rotateManychatToken } from "../actions";
import type { ManychatSecrets } from "@/lib/channels/manychat";

let seq = 0;
const key = () => `${2000000 + (++seq)}:${"b".repeat(32)}`;
function stub(status = 200, body: unknown = { status: "success", data: { id: 900 + seq, name: "Mi Tienda MC", is_pro: true } }) {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string, init: RequestInit) => {
    if (!String(input).startsWith("https://api.manychat.com/")) throw new Error("unexpected network call");
    calls.push(`${init.method} ${String(input)}`);
    return new Response(JSON.stringify(body), { status });
  }));
  return calls;
}

let A: TestTenant;
beforeEach(async () => { A = await newTenant("TiendaMC"); });
afterEach(() => { asUser(null); vi.unstubAllGlobals(); });

describe("connectManychat", () => {
  it("tests the key (getInfo), stores key + generated token encrypted, shows only the account name", async () => {
    const calls = stub();
    asUser(A);
    const k = key();
    expect(await connectManychat({ apiKey: `  ${k} ` })).toEqual({ ok: true, name: "Mi Tienda MC" });
    expect(calls).toEqual(["GET https://api.manychat.com/fb/page/getInfo"]);
    const acc = await getData().channels.get(A.tenantId, "manychat");
    expect(acc.status).toBe("connected");
    expect(JSON.stringify(acc.publicInfo)).not.toContain(k);
    const sec = await getData().secrets.get<ManychatSecrets>(A.tenantId, "channel", "manychat");
    expect(sec?.apiKey).toBe(k);
    expect(sec?.requestToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("reconnecting keeps the request token; rotating changes it; disconnect clears the secrets", async () => {
    stub();
    asUser(A);
    await connectManychat({ apiKey: key() });
    const t1 = (await getData().secrets.get<ManychatSecrets>(A.tenantId, "channel", "manychat"))?.requestToken;
    await connectManychat({ apiKey: key() });
    expect((await getData().secrets.get<ManychatSecrets>(A.tenantId, "channel", "manychat"))?.requestToken).toBe(t1);
    expect((await rotateManychatToken()).ok).toBe(true);
    expect((await getData().secrets.get<ManychatSecrets>(A.tenantId, "channel", "manychat"))?.requestToken).not.toBe(t1);
    await disconnectManychat();
    expect(await getData().secrets.get(A.tenantId, "channel", "manychat")).toBeNull();
    expect((await getData().channels.get(A.tenantId, "manychat")).status).toBe("disconnected");
  });

  it("bad key shape (no call), rejected key, network failure", async () => {
    const calls = stub(401, { status: "error", message: "unauthorized" });
    asUser(A);
    expect(await connectManychat({ apiKey: "hola" })).toEqual({ ok: false, error: "invalid" });
    expect(calls).toHaveLength(0);
    expect(await connectManychat({ apiKey: key() })).toEqual({ ok: false, error: "token" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("down"); }));
    expect(await connectManychat({ apiKey: key() })).toEqual({ ok: false, error: "network" });
    expect((await getData().channels.get(A.tenantId, "manychat")).status).not.toBe("connected");
  });
});
