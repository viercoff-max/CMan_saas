// L5 (REVIEW-security-2): only proxy headers the deployment configured are trusted for the client IP.
import { describe, expect, it } from "vitest";
import { clientIp, trustedProxyHeaders } from "../client-ip";

const h = (o: Record<string, string>) => new Headers(o);

describe("clientIp", () => {
  it("default: first x-forwarded-for hop, then x-real-ip; cf-connecting-ip is ignored (spoofable on Vercel)", () => {
    expect(clientIp(h({ "cf-connecting-ip": "6.6.6.6", "x-forwarded-for": "203.0.113.7, 10.0.0.1" }), {})).toBe("203.0.113.7");
    expect(clientIp(h({ "cf-connecting-ip": "6.6.6.6" }), {})).toBe("unknown");
    expect(clientIp(h({ "x-real-ip": "198.51.100.2" }), {})).toBe("198.51.100.2");
    expect(clientIp(h({}), {})).toBe("unknown");
  });
  it("TRUSTED_PROXY_HEADERS picks the headers and their order (Cloudflare tunnel, Vercel header)", () => {
    const cf = { TRUSTED_PROXY_HEADERS: "cf-connecting-ip" };
    expect(clientIp(h({ "cf-connecting-ip": "6.6.6.6", "x-forwarded-for": "1.1.1.1" }), cf)).toBe("6.6.6.6");
    expect(clientIp(h({ "x-forwarded-for": "1.1.1.1" }), cf)).toBe("unknown"); // XFF not trusted in that deployment
    const vercel = { TRUSTED_PROXY_HEADERS: " X-Vercel-Forwarded-For , x-real-ip " };
    expect(trustedProxyHeaders(vercel)).toEqual(["x-vercel-forwarded-for", "x-real-ip"]);
    expect(clientIp(h({ "x-vercel-forwarded-for": "2001:DB8::1", "x-forwarded-for": "9.9.9.9" }), vercel)).toBe("2001:db8::1");
    expect(trustedProxyHeaders({ TRUSTED_PROXY_HEADERS: "bad header!,," })).toEqual(["x-forwarded-for", "x-real-ip"]);
  });
  it("garbage values never become limiter keys", () => {
    expect(clientIp(h({ "x-forwarded-for": "<script>, 1.2.3.4" }), {})).toBe("unknown");
    expect(clientIp(h({ "x-forwarded-for": "x".repeat(300) }), {})).toBe("unknown");
    expect(clientIp(h({ "x-forwarded-for": "[2001:db8::2]:443" }), {})).toBe("2001:db8::2");
  });
});
