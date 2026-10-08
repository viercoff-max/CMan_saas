// Go-live fixes checked against shopify.dev (2026-10): API version, OAuth HMAC, order search, protected data,
// client credentials grant for Dev Dashboard apps.
import "../../channels/__tests__/env-secrets"; // temp SQLite + DATA_DIR + test APP_SECRET
import { randomUUID, createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { orderNameQuery, SHOPIFY_API_VERSION, validateOAuthHmac } from "../config";
import { ORDER_FIELDS } from "../mapping";
import { emailAccessDenied, shopifyConnector } from "../connector";
import { fetchClientCredentialsToken, getShopifySecrets, needsRefresh } from "../token";
import { getAddonSecrets, saveAddon } from "../../store";

afterEach(() => vi.unstubAllGlobals());

describe("versions and query", () => {
  it("pins a stable YYYY-MM Admin API version", () => expect(SHOPIFY_API_VERSION).toMatch(/^20\d\d-(01|04|07|10)$/));
  it("searches the order name with and without #", () => expect(orderNameQuery("1001")).toBe("name:#1001 OR name:1001"));
  it("does not ask for the Customer object (needs read_customers)", () => {
    expect(ORDER_FIELDS).not.toMatch(/customer/);
    expect(ORDER_FIELDS).toMatch(/\bemail\b/);
  });
});

describe("OAuth callback HMAC (current doc: decoded k=v sorted, joined with &)", () => {
  const secret = "client-secret";
  const sign = (msg: string) => createHmac("sha256", secret).update(msg).digest("hex");
  it("accepts a real-shaped callback including host (base64 with = padding)", () => {
    const p = { code: "0907a61c0c8d55e99db179b68161bc00", host: "YWRtaW4uc2hvcGlmeS5jb20vc3RvcmUvYQ==", shop: "a.myshopify.com", state: "abc", timestamp: "1337178173" };
    const msg = Object.keys(p).sort().map((k) => `${k}=${p[k as keyof typeof p]}`).join("&");
    expect(validateOAuthHmac({ ...p, hmac: sign(msg) }, secret)).toBe(true);
    expect(validateOAuthHmac({ ...p, host: "b3RoZXI=", hmac: sign(msg) }, secret)).toBe(false);
  });
  it("still accepts the legacy escaped form for values containing & or %", () => {
    const p = { code: "a&b", shop: "a.myshopify.com", timestamp: "1" };
    const legacy = "code=a%26b&shop=a.myshopify.com&timestamp=1";
    expect(validateOAuthHmac({ ...p, hmac: sign(legacy) }, secret)).toBe(true);
    expect(validateOAuthHmac({ ...p, hmac: sign("code=a&b&shop=a.myshopify.com&timestamp=1") }, secret)).toBe(true);
  });
});

describe("protected customer data", () => {
  it("detects 'not approved to access' errors only", () => {
    expect(emailAccessDenied([{ message: "This app is not approved to access the Order object's email field." }])).toBe(true);
    expect(emailAccessDenied([{ message: "Access denied for email field.", extensions: { code: "ACCESS_DENIED" } }])).toBe(true);
    expect(emailAccessDenied([{ message: "Throttled", extensions: { code: "THROTTLED" } }])).toBe(false);
    expect(emailAccessDenied(undefined)).toBe(false);
  });
});

describe("client credentials grant (Dev Dashboard app)", () => {
  it("posts a form-encoded client_credentials request and computes the expiry", async () => {
    const f = vi.fn(async (_u: string, _i: RequestInit) => new Response(JSON.stringify({ access_token: "tok1", scope: "read_orders", expires_in: 86399 }), { status: 200 }));
    const r = await fetchClientCredentialsToken("a.myshopify.com", "cid12345", "csecret123", f as unknown as typeof fetch, 1_000);
    expect(r).toEqual({ ok: true, accessToken: "tok1", scopes: "read_orders", expiresAt: 1_000 + 86399_000 });
    const [url, init] = f.mock.calls[0];
    expect(url).toBe("https://a.myshopify.com/admin/oauth/access_token");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/x-www-form-urlencoded");
    expect(String(init.body)).toBe("grant_type=client_credentials&client_id=cid12345&client_secret=csecret123");
  });
  it("maps rejected credentials and outages", async () => {
    const bad = vi.fn(async () => new Response("{}", { status: 400 }));
    expect(await fetchClientCredentialsToken("a.myshopify.com", "c", "s", bad as unknown as typeof fetch)).toEqual({ ok: false, error: "bad_credentials" });
    const down = vi.fn(async () => { throw new Error("x"); });
    expect(await fetchClientCredentialsToken("a.myshopify.com", "c", "s", down as unknown as typeof fetch)).toEqual({ ok: false, error: "unreachable" });
  });
  it("renews a token that is about to expire and keeps the rest of the secrets", async () => {
    const t = `t-${randomUUID()}`;
    saveAddon(t, "shopify", { status: "connected", secrets: { shop: "a.myshopify.com", accessToken: "old", grant: "client_credentials", clientId: "cid12345", clientSecret: "csecret123", expiresAt: Date.now() + 60_000, scopes: "read_orders" }, publicInfo: { shop: "a.myshopify.com" } });
    expect(needsRefresh(getAddonSecrets(t, "shopify")!)).toBe(true);
    const f = vi.fn(async () => new Response(JSON.stringify({ access_token: "new", scope: "read_orders", expires_in: 86399 }), { status: 200 }));
    const s = await getShopifySecrets(t, { fetch: f as unknown as typeof fetch });
    expect(s?.accessToken).toBe("new");
    expect(getAddonSecrets<{ accessToken: string; clientId: string }>(t, "shopify")).toMatchObject({ accessToken: "new", clientId: "cid12345" });
    expect(needsRefresh(getAddonSecrets(t, "shopify")!)).toBe(false);
  });
  it("static tokens are used as is", async () => {
    const t = `t-${randomUUID()}`;
    saveAddon(t, "shopify", { status: "connected", secrets: { shop: "a.myshopify.com", accessToken: "shpat_x" }, publicInfo: {} });
    expect((await getShopifySecrets(t))?.accessToken).toBe("shpat_x");
  });
});

describe("connector against a fake Admin API", () => {
  function store() {
    const t = `t-${randomUUID()}`;
    saveAddon(t, "shopify", { status: "connected", secrets: { shop: "a.myshopify.com", accessToken: "shpat_x", scopes: "read_orders" }, publicInfo: { shop: "a.myshopify.com" } });
    return t;
  }
  it("queries the pinned version with the order-name search and the token header", async () => {
    const t = store();
    const calls: { url: string; body: { variables: { q: string } }; token: string }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init.body)), token: (init.headers as Record<string, string>)["x-shopify-access-token"] });
      return new Response(JSON.stringify({ data: { orders: { nodes: [{ name: "#1001", email: "a@b.com", displayFulfillmentStatus: "UNFULFILLED", displayFinancialStatus: "PAID", fulfillments: [] }] } } }), { status: 200 });
    }));
    expect(await shopifyConnector.lookupOrderStatus(t, "#1001", "A@B.com")).toMatchObject({ found: true, statusText: "En preparación" });
    expect(calls[0].url).toBe(`https://a.myshopify.com/admin/api/${SHOPIFY_API_VERSION}/graphql.json`);
    expect(calls[0].body.variables.q).toBe("name:#1001 OR name:1001");
    expect(calls[0].token).toBe("shpat_x");
  });
  it("email not approved (protected customer data) -> throws a config error instead of 'not found'", async () => {
    const t = store();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      data: { orders: { nodes: [{ name: "#1001", email: null }] } },
      errors: [{ message: "This app is not approved to access the Order object's email field.", path: ["orders", "nodes", 0, "email"] }],
    }), { status: 200 })));
    await expect(shopifyConnector.lookupOrderStatus(t, "1001", "a@b.com")).rejects.toThrow("shopify_email_access_denied");
  });
});
