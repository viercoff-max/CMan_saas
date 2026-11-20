// Client IP for rate limiting and audit hashes (L5, REVIEW-security-2). Only headers the DEPLOYMENT says its proxy
// sets are trusted: env TRUSTED_PROXY_HEADERS = comma-separated header names, checked in order, first non-empty wins.
//
// Default when unset: "x-forwarded-for,x-real-ip", reading the FIRST x-forwarded-for hop.
//   * Vercel (the SaaS host) overwrites x-forwarded-for and x-real-ip with the real client IP and does not forward
//     client-sent values (Vercel docs, "Request headers"), so the first hop is the client there.
//   * cf-connecting-ip is NEVER trusted unless listed: on Vercel (not behind Cloudflare) any client can set it, which
//     let attackers rotate per-IP limits. Behind a Cloudflare tunnel (on-prem build) set
//     TRUSTED_PROXY_HEADERS=cf-connecting-ip. Directly exposed Node without a proxy: x-forwarded-for is client-controlled,
//     which is why every limiter is ALSO keyed per e-mail / tenant.
// Values are sanitised (IPv4/IPv6 characters only, max 64) so a header can never inject odd keys; anything else is
// "unknown".
const DEFAULT_HEADERS = ["x-forwarded-for", "x-real-ip"];
const NAME = /^[a-z0-9-]{1,64}$/;
const IP = /^[0-9a-fA-F:.]{2,64}$/;

export function trustedProxyHeaders(env: Record<string, string | undefined> = process.env): string[] {
  const raw = env.TRUSTED_PROXY_HEADERS?.trim();
  if (!raw) return DEFAULT_HEADERS;
  const names = raw.split(",").map((s) => s.trim().toLowerCase()).filter((s) => NAME.test(s));
  return names.length ? names : DEFAULT_HEADERS;
}

export function clientIp(h: { get(name: string): string | null }, env: Record<string, string | undefined> = process.env): string {
  for (const name of trustedProxyHeaders(env)) {
    const v = h.get(name);
    if (!v) continue;
    // Multi-hop headers (x-forwarded-for, x-vercel-forwarded-for): the first hop is the client.
    const first = v.split(",")[0].trim().replace(/^\[|\](:\d+)?$/g, "");
    if (IP.test(first)) return first.toLowerCase();
  }
  return "unknown";
}
