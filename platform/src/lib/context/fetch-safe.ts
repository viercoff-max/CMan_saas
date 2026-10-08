// SSRF-safe HTTP fetch: http/https only, public IPs only (checked after DNS resolution AND pinned at connect time),
// 10 s timeout, 2 MB cap, max 3 redirects each re-validated.
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";

export const MAX_BYTES = 2 * 1024 * 1024;
export const TIMEOUT_MS = 10_000;
export const MAX_REDIRECTS = 3;
export const ALLOWED_PORTS = new Set(["", "80", "443", "8080", "8443"]);

export class UnsafeUrlError extends Error {
  code: string; // explicit field (no parameter property) so Node's strip-only TS loader can run CLI scripts
  constructor(code: string, message?: string) { super(message ?? code); this.code = code; this.name = "UnsafeUrlError"; }
}

function ipv6ToGroups(ip: string): number[] | null {
  let s = ip.split("%")[0].toLowerCase();
  const v4 = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (v4 && net.isIPv4(v4[1])) {
    const p = v4[1].split(".").map(Number);
    s = s.slice(0, -v4[1].length) + ((p[0] << 8) | p[1]).toString(16) + ":" + ((p[2] << 8) | p[3]).toString(16);
  }
  const halves = s.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  if (fill < 0 || (halves.length === 1 && head.length !== 8)) return null;
  const groups = [...head, ...Array(fill).fill("0"), ...tail].map((g) => parseInt(g || "0", 16));
  return groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null;
}

function isPrivateV4(a: number, b: number): boolean {
  return (
    a === 0 || a === 10 || a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||  // CGNAT
    (a === 169 && b === 254) ||            // link-local / cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 192 && b === 0) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224                               // multicast, reserved, broadcast
  );
}

/** True when the IP is not a public unicast address (or is not a valid IP at all). */
export function isPrivateIp(ip: string): boolean {
  const clean = ip.replace(/^\[|\]$/g, "");
  if (net.isIPv4(clean)) {
    const [a, b] = clean.split(".").map(Number);
    return isPrivateV4(a, b);
  }
  if (net.isIPv6(clean)) {
    const g = ipv6ToGroups(clean);
    if (!g) return true;
    if (g.every((x) => x === 0)) return true;                            // ::
    if (g.slice(0, 7).every((x) => x === 0) && g[7] === 1) return true;  // ::1
    if ((g[0] & 0xfe00) === 0xfc00) return true;                          // fc00::/7 ULA
    if ((g[0] & 0xffc0) === 0xfe80) return true;                          // fe80::/10 link-local
    if ((g[0] & 0xffc0) === 0xfec0) return true;                          // fec0::/10 site-local (deprecated)
    if (g[0] === 0x2001 && g[1] === 0) return true;                       // 2001::/32 Teredo (hides the IPv4 inside)
    if (g[0] === 0x64 && g[1] === 0xff9b && g[2] === 1) return true;      // 64:ff9b:1::/48 local-use NAT64
    if ((g[0] & 0xff00) === 0xff00) return true;                          // multicast
    if (g.slice(0, 5).every((x) => x === 0) && (g[5] === 0xffff || g[5] === 0)) {
      return isPrivateV4(g[6] >> 8, g[6] & 0xff);                         // IPv4-mapped / compatible
    }
    if (g[0] === 0x64 && g[1] === 0xff9b) return isPrivateV4(g[6] >> 8, g[6] & 0xff); // NAT64
    if (g[0] === 0x2002) return isPrivateV4(g[1] >> 8, g[1] & 0xff);      // 6to4
    return false;
  }
  return true;
}

export type Resolver = (hostname: string) => Promise<string[]>;
const defaultResolver: Resolver = async (h) => (await dns.promises.lookup(h, { all: true })).map((r) => r.address);

/** Validate scheme + host; resolves DNS and rejects if ANY address is private. Returns the parsed URL. */
export async function assertSafeUrl(raw: string, resolve: Resolver = defaultResolver): Promise<URL> {
  let u: URL;
  try { u = new URL(raw); } catch { throw new UnsafeUrlError("invalid_url"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new UnsafeUrlError("bad_scheme");
  if (u.username || u.password) throw new UnsafeUrlError("credentials_in_url");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (!host) throw new UnsafeUrlError("invalid_url");
  const lower = host.toLowerCase();
  if (lower === "localhost" || lower.endsWith(".localhost") || lower.endsWith(".local") || lower.endsWith(".internal"))
    throw new UnsafeUrlError("private_host");
  if (net.isIP(host) && isPrivateIp(host)) throw new UnsafeUrlError("private_host");
  // Only standard web ports ("" = scheme default). Blocks probing odd services on public IPs.
  if (!ALLOWED_PORTS.has(u.port)) throw new UnsafeUrlError("bad_port");
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new UnsafeUrlError("private_host");
    return u;
  }
  let addrs: string[];
  try { addrs = await resolve(host); } catch { throw new UnsafeUrlError("dns_failed"); }
  if (!addrs.length) throw new UnsafeUrlError("dns_failed");
  if (addrs.some(isPrivateIp)) throw new UnsafeUrlError("private_host");
  return u;
}

export interface SafeResponse { status: number; contentType: string; body: Buffer; finalUrl: string }

function requestOnce(u: URL, resolve: Resolver, deadline: number): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolveP, reject) => {
    const mod = u.protocol === "https:" ? https : http;
    // Pin the connection to validated addresses (defeats DNS rebinding between check and connect).
    const lookup = (hostname: string, opts: { all?: boolean }, cb: (...a: unknown[]) => void) => {
      resolve(hostname).then((addrs) => {
        if (!addrs.length || addrs.some(isPrivateIp)) return cb(new UnsafeUrlError("private_host"));
        if (opts && opts.all) return cb(null, addrs.map((address) => ({ address, family: net.isIPv6(address) ? 6 : 4 })));
        cb(null, addrs[0], net.isIPv6(addrs[0]) ? 6 : 4);
      }, () => cb(new UnsafeUrlError("dns_failed")));
    };
    const remaining = Math.max(1, deadline - Date.now());
    const req = mod.request(u, {
      method: "GET",
      headers: { "user-agent": "SocialInboxBot/1.0 (knowledge-sync)", accept: "text/html,text/plain,text/csv,application/pdf,*/*;q=0.5", "accept-encoding": "identity" },
      lookup: lookup as never,
      timeout: remaining,
    }, (res) => {
      const chunks: Buffer[] = [];
      let size = 0;
      res.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BYTES) { req.destroy(new UnsafeUrlError("too_large")); return; }
        chunks.push(c);
      });
      res.on("end", () => resolveP({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.on("timeout", () => req.destroy(new UnsafeUrlError("timeout")));
    req.on("error", reject);
    const t = setTimeout(() => req.destroy(new UnsafeUrlError("timeout")), remaining);
    req.on("close", () => clearTimeout(t));
    req.end();
  });
}

export async function fetchSafe(rawUrl: string, resolve: Resolver = defaultResolver): Promise<SafeResponse> {
  const deadline = Date.now() + TIMEOUT_MS;
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const u = await assertSafeUrl(current, resolve);
    const r = await requestOnce(u, resolve, deadline);
    if ([301, 302, 303, 307, 308].includes(r.status)) {
      const loc = r.headers.location;
      if (!loc) throw new UnsafeUrlError("bad_redirect");
      current = new URL(loc, u).toString();
      continue;
    }
    if (r.status < 200 || r.status >= 300) throw new UnsafeUrlError(`http_${r.status}`);
    return { status: r.status, contentType: String(r.headers["content-type"] ?? ""), body: r.body, finalUrl: u.toString() };
  }
  throw new UnsafeUrlError("too_many_redirects");
}
