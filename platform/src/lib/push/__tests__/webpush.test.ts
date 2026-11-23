import { createPublicKey, verify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { isAllowedEndpoint, sendPush, vapidHeader, vapidKeys } from "../webpush";

const ENV = { APP_SECRET: "test-secret-0123456789abcdef" };

describe("VAPID keys derived from APP_SECRET", () => {
  it("are deterministic, a valid P-256 public point, and change with the secret", () => {
    const a = vapidKeys(ENV), b = vapidKeys({ ...ENV });
    expect(a.publicKey).toBe(b.publicKey);
    const pub = Buffer.from(a.publicKey, "base64url");
    expect(pub).toHaveLength(65);
    expect(pub[0]).toBe(4);
    expect(vapidKeys({ APP_SECRET: "another-secret-abcdef0123456789" }).publicKey).not.toBe(a.publicKey);
    expect(() => vapidKeys({ APP_SECRET: "short" })).toThrow();
  });

  it("the Authorization header is an ES256 JWT for the push service origin, verifiable with the public key", () => {
    const h = vapidHeader("https://fcm.googleapis.com/fcm/send/abc123", "https://app.example", 1_800_000_000_000, ENV);
    const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h)!;
    expect(m).toBeTruthy();
    const payload = JSON.parse(Buffer.from(m[2], "base64url").toString());
    expect(payload).toMatchObject({ aud: "https://fcm.googleapis.com", sub: "https://app.example", exp: 1_800_000_000 + 12 * 3600 });
    const { jwk } = vapidKeys(ENV);
    const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y }, format: "jwk" });
    expect(verify("sha256", Buffer.from(`${m[1]}.${m[2]}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(m[3], "base64url"))).toBe(true);
    expect(m[4]).toBe(vapidKeys(ENV).publicKey);
  });
});

describe("endpoint allowlist (SSRF guard)", () => {
  it.each([
    ["https://fcm.googleapis.com/fcm/send/abcdefghijk", true],
    ["https://updates.push.services.mozilla.com/wpush/v2/abcdef", true],
    ["https://web.push.apple.com/QWERTYUIOPasdfgh", true],
    ["https://wns2-bl2p.notify.windows.com/w/?token=abc", true],
    ["http://fcm.googleapis.com/fcm/send/abcdefghijk", false],
    ["https://evil.example.com/fcm.googleapis.com/x", false],
    ["https://user:pw@fcm.googleapis.com/fcm/send/abcdefghijk", false],
    ["https://fcm.googleapis.com:8443/fcm/send/abcdefghijk", false],
    ["https://169.254.169.254/latest/meta-data/xx", false],
    ["https://push.apple.com.evil.com/abcdefghijklmn", false],
  ])("%s -> %s", (u, ok) => expect(isAllowedEndpoint(u)).toBe(ok));
});

describe("sendPush", () => {
  it("empty body, TTL/Urgency/VAPID headers; 410 = gone; blocked endpoints never fetched", async () => {
    process.env.APP_SECRET = ENV.APP_SECRET;
    const calls: { url: string; init: RequestInit }[] = [];
    const f = vi.fn(async (url: string, init: RequestInit) => { calls.push({ url, init }); return new Response(null, { status: calls.length === 1 ? 201 : 410 }); });
    expect(await sendPush("https://fcm.googleapis.com/fcm/send/abcdefghijk", { urgent: true }, f as unknown as typeof fetch)).toBe("ok");
    const hdr = calls[0].init.headers as Record<string, string>;
    expect(hdr.TTL).toBe("3600");
    expect(hdr.Urgency).toBe("high");
    expect(hdr.authorization).toMatch(/^vapid t=/);
    expect(calls[0].init.body).toBeUndefined();
    expect(await sendPush("https://fcm.googleapis.com/fcm/send/abcdefghijk", {}, f as unknown as typeof fetch)).toBe("gone");
    expect(await sendPush("https://evil.example.com/abcdefghijklmnop", {}, f as unknown as typeof fetch)).toBe("blocked");
    expect(calls).toHaveLength(2);
  });
});
