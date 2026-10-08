import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { normalizeOrderNumber, normalizeShopDomain, validateOAuthHmac } from "../config";
import { mapOrderToStatus, type ShopifyOrderNode } from "../mapping";
import { mockLookup, MOCK_EMAIL } from "../mock";
import { resolveOrder } from "../connector";

describe("shop domain", () => {
  it("normalizes valid input", () => {
    expect(normalizeShopDomain("my-store")).toBe("my-store.myshopify.com");
    expect(normalizeShopDomain(" My-Store.myshopify.com ")).toBe("my-store.myshopify.com");
    expect(normalizeShopDomain("https://my-store.myshopify.com/admin")).toBe("my-store.myshopify.com");
  });
  it("rejects invalid or hostile input", () => {
    for (const bad of ["", "-bad", "evil.com", "a.myshopify.com.evil.com", "my store", "x@evil.com#.myshopify.com", "a_b.myshopify.com", "https://evil.com/.myshopify.com"])
      expect(normalizeShopDomain(bad), bad).toBeNull();
  });
});

describe("oauth hmac", () => {
  const secret = "shhh";
  const make = (p: Record<string, string>) => {
    const msg = Object.keys(p).sort().map((k) => `${k}=${p[k]}`).join("&");
    return createHmac("sha256", secret).update(msg).digest("hex");
  };
  const base = { code: "abc", shop: "a.myshopify.com", state: "s1", timestamp: "1700000000" };
  it("accepts a valid hmac", () => expect(validateOAuthHmac({ ...base, hmac: make(base) }, secret)).toBe(true));
  it("rejects tampering, missing and wrong secret", () => {
    const h = make(base);
    expect(validateOAuthHmac({ ...base, code: "zzz", hmac: h }, secret)).toBe(false);
    expect(validateOAuthHmac(base as Record<string, string>, secret)).toBe(false);
    expect(validateOAuthHmac({ ...base, hmac: h }, "other")).toBe(false);
    expect(validateOAuthHmac({ ...base, hmac: "00" }, secret)).toBe(false);
  });
});

describe("order number", () => {
  it("strips # and spaces", () => {
    expect(normalizeOrderNumber("# 1001")).toBe("1001");
    expect(normalizeOrderNumber("1001")).toBe("1001");
    expect(normalizeOrderNumber("name:1 OR 2")).toBeNull();
    expect(normalizeOrderNumber("")).toBeNull();
  });
});

const fixture: ShopifyOrderNode & Record<string, unknown> = {
  name: "#2001", email: "Cliente@Mail.com", customer: { email: "cliente@mail.com" },
  cancelledAt: null, displayFulfillmentStatus: "FULFILLED", displayFinancialStatus: "PAID",
  shippingAddress: { address1: "Calle Secreta 1", phone: "555" }, totalPriceSet: { shopMoney: { amount: "999" } },
  lineItems: [{ title: "Licuadora" }],
  fulfillments: [{ displayStatus: "IN_TRANSIT", estimatedDeliveryAt: "2026-10-12T10:00:00Z",
    trackingInfo: [{ company: "DHL", number: "TRK1", url: "https://dhl.example/TRK1" }] }],
};

describe("status mapping", () => {
  it("maps shipped with tracking and leaks nothing else", () => {
    const r = mapOrderToStatus(fixture);
    expect(r).toEqual({ found: true, statusText: "Enviado", carrier: "DHL", trackingNumber: "TRK1", trackingUrl: "https://dhl.example/TRK1", estimatedDelivery: "2026-10-12" });
    const s = JSON.stringify(r);
    for (const secret of ["Secreta", "555", "999", "Licuadora", "cliente@mail.com"]) expect(s).not.toContain(secret);
  });
  it("covers the other states", () => {
    expect(mapOrderToStatus({ cancelledAt: "x", displayFulfillmentStatus: "UNFULFILLED" }).statusText).toBe("Cancelado");
    expect(mapOrderToStatus({ displayFulfillmentStatus: "UNFULFILLED", displayFinancialStatus: "PENDING" }).statusText).toBe("Pago pendiente");
    expect(mapOrderToStatus({ displayFulfillmentStatus: "UNFULFILLED", displayFinancialStatus: "PAID" }).statusText).toBe("En preparación");
    expect(mapOrderToStatus({ displayFulfillmentStatus: "FULFILLED", fulfillments: [{ displayStatus: "DELIVERED" }] }).statusText).toBe("Entregado");
  });
  it("ignores non-http tracking urls", () => {
    const r = mapOrderToStatus({ displayFulfillmentStatus: "FULFILLED", fulfillments: [{ trackingInfo: [{ number: "1", url: "javascript:alert(1)" }] }] });
    expect(r.trackingUrl).toBeUndefined();
  });
});

describe("resolveOrder", () => {
  it("matches email case-insensitively", () => {
    expect(resolveOrder([fixture], "2001", " CLIENTE@mail.COM ", true).found).toBe(true);
  });
  it("not found, email mismatch and missing email return the SAME shape (no existence oracle)", () => {
    for (const hasAll of [false, true]) {
      const notFound = resolveOrder([], "2001", "cliente@mail.com", hasAll);
      const mismatch = resolveOrder([fixture], "2001", "otro@mail.com", hasAll);
      const noEmailOnOrder = resolveOrder([{ name: "#2001" }], "2001", "cliente@mail.com", hasAll);
      const noEmailGiven = resolveOrder([fixture], "2001", "", hasAll);
      expect(mismatch).toEqual(notFound);
      expect(noEmailOnOrder).toEqual(notFound);
      expect(noEmailGiven).toEqual(notFound);
      expect(notFound).toEqual({ found: false, mayBeOutsideWindow: !hasAll });
      expect(notFound).not.toHaveProperty("tooOld");
    }
  });
  it("mayBeOutsideWindow depends only on the shop scopes", () => {
    expect(resolveOrder([fixture], "2001", "otro@mail.com", false).mayBeOutsideWindow).toBe(true);
    expect(resolveOrder([], "2001", "a@b.com", false).mayBeOutsideWindow).toBe(true);
    expect(resolveOrder([], "2001", "a@b.com", true).mayBeOutsideWindow).toBe(false);
  });
  it("does not match a different order", () => {
    expect(resolveOrder([{ ...fixture, name: "#12001" }], "2001", "cliente@mail.com", true).found).toBe(false);
  });
});

describe("mock mode", () => {
  it("answers sample orders", () => {
    expect(mockLookup("#1001", MOCK_EMAIL)).toMatchObject({ found: true, statusText: "Enviado", carrier: "Estafeta" });
    expect(mockLookup("1002", "TEST@example.com").statusText).toBe("En preparación");
    expect(mockLookup("1003", MOCK_EMAIL).statusText).toBe("Entregado");
    expect(mockLookup("1004", MOCK_EMAIL).statusText).toBe("Cancelado");
  });
  it("fails generically on mismatch or unknown order", () => {
    expect(mockLookup("1001", "x@y.com")).toEqual({ found: false });
    expect(mockLookup("9999", MOCK_EMAIL)).toEqual({ found: false });
  });
});
