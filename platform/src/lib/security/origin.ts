// CSRF guard for cookie-authenticated route handlers (REVIEW-security M2).
// Server Actions already get an Origin-vs-Host check from Next (docs: 02-guides/server-actions.md "CSRF check");
// route handlers do NOT, so every state-changing route must call assertSameOrigin(req) first.
//
// Usage in a route handler:
//   try { assertSameOrigin(req); } catch (e) { if (e instanceof Response) return e; throw e; }
// or:  const bad = checkSameOrigin(req); if (bad) return bad;
//
// Do NOT use it on: Meta webhooks (signed by Meta) and the Shopify OAuth callback GET (signed state + HMAC).

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function hostOf(u: string | null | undefined): string | null {
  if (!u) return null;
  try { return new URL(u).host.toLowerCase(); } catch { return null; }
}

/** Hosts this app legitimately serves: PUBLIC_URL, the Host header, X-Forwarded-Host (set by tunnels/proxies), the request URL. */
export function allowedHosts(req: Request): Set<string> {
  const out = new Set<string>();
  const add = (h: string | null | undefined) => { if (h) out.add(h.trim().toLowerCase()); };
  add(hostOf(process.env.PUBLIC_URL));
  add(req.headers.get("host"));
  for (const h of (req.headers.get("x-forwarded-host") ?? "").split(",")) add(h || null);
  add(hostOf(req.url));
  out.delete("");
  return out;
}

function forbidden(reason: string): Response {
  return new Response(JSON.stringify({ error: "forbidden_origin" }), {
    status: 403, headers: { "content-type": "application/json", "x-reject-reason": reason },
  });
}

/** Returns null when the request is same-origin, or a 403 Response to return as is. */
export function checkSameOrigin(req: Request): Response | null {
  const method = req.method.toUpperCase();
  const fetchSite = req.headers.get("sec-fetch-site");
  // Browsers send this on every request; anything other than same-origin (or "none" = typed URL) is cross-origin.
  if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none" && !SAFE_METHODS.has(method)) return forbidden("fetch_site");

  const hosts = allowedHosts(req);
  const origin = req.headers.get("origin");
  if (origin && origin !== "null") {
    const h = hostOf(origin);
    return h && hosts.has(h) ? null : forbidden("origin");
  }
  if (origin === "null") return forbidden("origin_null");

  // No Origin header: only safe methods may proceed; otherwise fall back to Referer.
  if (SAFE_METHODS.has(method)) return null;
  const ref = hostOf(req.headers.get("referer"));
  if (ref && hosts.has(ref)) return null;
  return forbidden("missing_origin");
}

/** Throws a 403 Response when the request is not same-origin. */
export function assertSameOrigin(req: Request): void {
  const bad = checkSameOrigin(req);
  if (bad) throw bad;
}
