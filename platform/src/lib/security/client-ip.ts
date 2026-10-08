// Best-effort client IP for rate limiting. Behind a tunnel (cloudflared/ngrok) the tunnel sets these headers.
// A direct client can spoof X-Forwarded-For, which is why login is ALSO limited per email.
export function clientIp(h: { get(name: string): string | null }): string {
  const cf = h.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = h.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim() || "unknown";
  return h.get("x-real-ip")?.trim() || "unknown";
}
