import { describe, expect, it, vi } from "vitest";
import { classifyGraphError, testChannelCredentials } from "../graph-test";
import { FB_GRAPH, IG_GRAPH } from "@/lib/channels/graph";

const resp = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }));
const asFetch = (fn: unknown) => fn as unknown as typeof fetch;

describe("classifyGraphError", () => {
  it("maps Meta codes to categories", () => {
    expect(classifyGraphError(400, { error: { code: 190 } })).toBe("token");
    expect(classifyGraphError(400, { error: { code: 100 } })).toBe("id");
    expect(classifyGraphError(403, { error: { code: 200 } })).toBe("permissions");
    expect(classifyGraphError(400, { error: { code: 4 } })).toBe("rate");
    expect(classifyGraphError(500, {})).toBe("unknown");
  });
});

describe("testChannelCredentials", () => {
  it("returns the page name on success and sends the token in a header, not the URL", async () => {
    const f = vi.fn(() => resp(200, { name: "Chefman MX" }));
    const r = await testChannelCredentials("messenger", { externalId: "123456", accessToken: "SECRET-TOKEN-123" }, asFetch(f));
    expect(r).toEqual({ ok: true, name: "Chefman MX" });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/123456?fields=name");
    expect(url).not.toContain("SECRET");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer SECRET-TOKEN-123");
  });
  it("fails on a rejected token and on network errors", async () => {
    const bad = vi.fn(() => resp(400, { error: { code: 190, message: "Invalid OAuth access token" } }));
    expect(await testChannelCredentials("instagram", { externalId: "1", accessToken: "x".repeat(12) }, asFetch(bad))).toEqual({ ok: false, error: "token" });
    const down = vi.fn(() => Promise.reject(new Error("boom")));
    expect(await testChannelCredentials("instagram", { externalId: "1", accessToken: "x".repeat(12) }, asFetch(down))).toEqual({ ok: false, error: "network" });
  });
  it("messenger: subscribes the app to the Page webhooks with the Page token", async () => {
    const f = vi.fn(() => resp(200, { name: "Chefman MX", success: true }));
    expect(await testChannelCredentials("messenger", { externalId: "123456", accessToken: "EAAP-123456789" }, asFetch(f))).toEqual({ ok: true, name: "Chefman MX" });
    const [url, init] = f.mock.calls[1] as unknown as [string, RequestInit];
    expect(init.method).toBe("POST");
    expect(url).toBe(`${FB_GRAPH}/123456/subscribed_apps?subscribed_fields=messages%2Cmessaging_postbacks`);
  });
  it("messenger: a user token (not a Page token) fails at the subscription step", async () => {
    const f = vi.fn()
      .mockImplementationOnce(() => resp(200, { name: "Chefman MX" }))
      .mockImplementationOnce(() => resp(400, { error: { code: 210, message: "A page access token is required" } }));
    expect(await testChannelCredentials("messenger", { externalId: "1", accessToken: "x".repeat(12) }, asFetch(f))).toEqual({ ok: false, error: "webhook" });
  });
  it("instagram through a Page: checks the IG node, subscribes /me (the Page)", async () => {
    const f = vi.fn(() => resp(200, { username: "chefmanmx", success: true }));
    expect(await testChannelCredentials("instagram", { externalId: "1784", accessToken: "EAAI-123456789" }, asFetch(f))).toEqual({ ok: true, name: "chefmanmx" });
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe(`${FB_GRAPH}/1784?fields=username%2Cname`);
    expect((f.mock.calls[1] as unknown as [string])[0]).toBe(`${FB_GRAPH}/me/subscribed_apps?subscribed_fields=messages%2Cmessaging_postbacks`);
  });
  it("instagram with an Instagram Login token: graph.instagram.com, user_id must match the ID typed", async () => {
    const ok = vi.fn(() => resp(200, { user_id: "1784", username: "chefmanmx", success: true }));
    expect(await testChannelCredentials("instagram", { externalId: "1784", accessToken: "IGAA-123456789" }, asFetch(ok))).toEqual({ ok: true, name: "chefmanmx", igLogin: true });
    expect((ok.mock.calls[0] as unknown as [string])[0]).toBe(`${IG_GRAPH}/me?fields=user_id,username`);
    expect((ok.mock.calls[1] as unknown as [string])[0]).toBe(`${IG_GRAPH}/me/subscribed_apps?subscribed_fields=messages%2Cmessaging_postbacks`);
    const other = vi.fn(() => resp(200, { user_id: "9999", username: "otra" }));
    expect(await testChannelCredentials("instagram", { externalId: "1784", accessToken: "IGAA-123456789" }, asFetch(other))).toEqual({ ok: false, error: "id" });
  });
  it("whatsapp: subscribes the app to the WABA after checking number and WABA", async () => {
    const f = vi.fn()
      .mockImplementationOnce(() => resp(200, { verified_name: "Chefman", display_phone_number: "+52 55" }))
      .mockImplementationOnce(() => resp(200, { name: "Chefman WABA" }))
      .mockImplementationOnce(() => resp(200, { success: true }));
    expect(await testChannelCredentials("whatsapp", { externalId: "11", accessToken: "x".repeat(12), wabaId: "22" }, asFetch(f))).toEqual({ ok: true, name: "Chefman" });
    expect((f.mock.calls[0] as unknown as [string])[0]).toBe(`${FB_GRAPH}/11?fields=verified_name%2Cdisplay_phone_number`);
    expect((f.mock.calls[2] as unknown as [string, RequestInit])).toEqual([`${FB_GRAPH}/22/subscribed_apps`, expect.objectContaining({ method: "POST" })]);
  });
  it("whatsapp checks the number and the WABA", async () => {
    const f = vi.fn()
      .mockImplementationOnce(() => resp(200, { verified_name: "Chefman" }))
      .mockImplementationOnce(() => resp(400, { error: { code: 100 } }));
    expect(await testChannelCredentials("whatsapp", { externalId: "11", accessToken: "x".repeat(12), wabaId: "22" }, asFetch(f))).toEqual({ ok: false, error: "id" });
  });
});
