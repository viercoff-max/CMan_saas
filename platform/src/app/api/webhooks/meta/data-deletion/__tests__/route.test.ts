import { describe, expect, it, vi } from "vitest";

const handle = vi.fn();
const status = vi.fn();
vi.mock("@/lib/retention/meta-deletion", () => ({ handleMetaDataDeletion: (s: string) => handle(s), deletionStatus: (c: string) => status(c) }));

import { GET, POST } from "../route";

const form = (body: string) =>
  new Request("http://localhost/api/webhooks/meta/data-deletion", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body,
  });

describe("meta data-deletion callback", () => {
  it("returns url + confirmation_code for a valid signed_request", async () => {
    handle.mockReturnValueOnce({ url: "https://x.test/deletion?code=abc", confirmation_code: "abc" });
    const res = await POST(form("signed_request=aaa.bbb"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "https://x.test/deletion?code=abc", confirmation_code: "abc" });
    expect(handle).toHaveBeenCalledWith("aaa.bbb");
  });
  it("rejects a missing or invalid signed_request with 400", async () => {
    expect((await POST(form(""))).status).toBe(400);
    handle.mockImplementationOnce(() => { throw new Error("bad sig"); });
    expect((await POST(form("signed_request=bad"))).status).toBe(400);
  });
  it("GET status URL answers received/unknown for a confirmation code", async () => {
    status.mockReturnValueOnce("received");
    const ok = await GET(new Request("http://localhost/api/webhooks/meta/data-deletion?code=ABCDEF0123456789ABCD"));
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ confirmation_code: "ABCDEF0123456789ABCD", status: "received" });
    expect(status).toHaveBeenCalledWith("ABCDEF0123456789ABCD");
    const none = await GET(new Request("http://localhost/api/webhooks/meta/data-deletion"));
    expect(await none.json()).toMatchObject({ status: "unknown" });
  });
});
