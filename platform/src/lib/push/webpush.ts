// Web Push without a payload (RFC 8030 + VAPID RFC 8292). SERVER ONLY.
// - No message content travels through Google / Apple / Mozilla: the push is empty; the service worker then fetches
//   the notice text from /api/push/latest with the person's own session.
// - VAPID key pair DERIVED from APP_SECRET (HMAC-SHA256 "vapid-v1" -> P-256 private scalar), so no new environment
//   variable is needed. Rotating APP_SECRET changes the key: devices must turn notices on again.
// - SSRF guard: only https endpoints of the known browser push services are ever called.
import { createECDH, createHmac, createPrivateKey, sign } from "node:crypto";

const N = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551"); // P-256 order
const b64u = (b: Buffer | Uint8Array) => Buffer.from(b).toString("base64url");

let cached: { secret: string; publicKey: string; jwk: { kty: "EC"; crv: "P-256"; d: string; x: string; y: string } } | null = null;

/** The platform's VAPID keys (public key as base64url uncompressed point, for PushManager.subscribe). */
export function vapidKeys(env: Record<string, string | undefined> = process.env) {
  const secret = env.APP_SECRET ?? "";
  if (secret.length < 16) throw new Error("APP_SECRET missing");
  if (cached && cached.secret === secret) return cached;
  let d: Buffer | null = null;
  for (let i = 0; i < 16 && !d; i++) {
    const h = createHmac("sha256", secret).update(`vapid-v1:${i}`).digest();
    const v = BigInt(`0x${h.toString("hex")}`);
    if (v > BigInt(0) && v < N) d = h;
  }
  if (!d) throw new Error("vapid derivation failed");
  const ecdh = createECDH("prime256v1");
  ecdh.setPrivateKey(d);
  const pub = ecdh.getPublicKey(); // 0x04 || X || Y
  cached = {
    secret,
    publicKey: b64u(pub),
    jwk: { kty: "EC", crv: "P-256", d: b64u(d), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
  };
  return cached;
}

const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^android\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^[a-z0-9.-]+\.push\.apple\.com$/, /^[a-z0-9.-]+\.notify\.windows\.com$/];

/** Only https URLs of the known push services (Chrome/Edge/Android, Firefox, Safari/iOS, Windows). */
export function isAllowedEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length < 20 || endpoint.length > 1000) return false;
  try {
    const u = new URL(endpoint);
    return u.protocol === "https:" && !u.username && !u.password && (u.port === "" || u.port === "443") && PUSH_HOSTS.some((r) => r.test(u.hostname));
  } catch { return false; }
}

/** VAPID Authorization header for one push service origin. */
export function vapidHeader(endpoint: string, subject: string, now = Date.now(), env: Record<string, string | undefined> = process.env): string {
  const keys = vapidKeys(env);
  const aud = new URL(endpoint).origin;
  const header = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const payload = b64u(Buffer.from(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })));
  const key = createPrivateKey({ key: keys.jwk, format: "jwk" });
  const sig = sign("sha256", Buffer.from(`${header}.${payload}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${payload}.${b64u(sig)}, k=${keys.publicKey}`;
}

export type PushResult = "ok" | "gone" | "failed" | "blocked";

/** Sends one payload-less push. "gone" = the device unsubscribed (404/410): delete the subscription. */
export async function sendPush(endpoint: string, opts: { urgent?: boolean; subject?: string } = {}, f: typeof fetch = fetch): Promise<PushResult> {
  if (!isAllowedEndpoint(endpoint)) return "blocked";
  const subject = opts.subject ?? `${(process.env.PUBLIC_URL ?? "https://conversa-mvp.vercel.app").replace(/\/+$/, "")}`;
  try {
    const res = await f(endpoint, {
      method: "POST",
      headers: { TTL: "3600", Urgency: opts.urgent ? "high" : "normal", authorization: vapidHeader(endpoint, subject), "content-length": "0" },
      signal: AbortSignal.timeout(8000),
    });
    if (res.status === 404 || res.status === 410) return "gone";
    return res.ok ? "ok" : "failed";
  } catch { return "failed"; }
}
