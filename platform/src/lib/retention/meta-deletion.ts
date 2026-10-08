// Meta "Data Deletion Request Callback" (App Dashboard > Settings > Basic > Data deletion).
// Meta POSTs form field `signed_request` = base64url(HMAC-SHA256(payload_b64, APP_SECRET)) + "." + payload_b64,
// payload = {"algorithm":"HMAC-SHA256","issued_at":...,"user_id":"<app-scoped id>"}.
// We must answer JSON {url, confirmation_code}; `url` is a page where the person can check the status.
//
// The ROUTE is owned by the inbox module (src/app/api/webhooks/meta/data-deletion/route.ts):
//   POST: const { url, confirmation_code } = handleMetaDataDeletion(signed_request)  // throws MetaDeletionError -> 400
//   GET ?code=: deletionStatus(code) -> "received" | "unknown" (the status page Meta links to)
//
// CAVEAT: user_id is the app-scoped id from Facebook Login. Messenger PSIDs / IG ids are different ids, so the match
// below only finds data when they coincide; it is still the required, auditable intake. Other requests go to a person.
import { createHmac, timingSafeEqual } from "node:crypto";
import { getDb } from "../db";
import { audit } from "../store";
import { deleteCustomerData } from "./index";

export type SignedRequestPayload = { algorithm?: string; issued_at?: number; user_id?: string; [k: string]: unknown };

function b64urlDecode(s: string): Buffer {
  return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

/** Verifies the HMAC and returns the payload, or null when malformed / wrong signature / wrong algorithm. */
export function parseSignedRequest(signedRequest: string, appSecret: string): SignedRequestPayload | null {
  if (!appSecret || typeof signedRequest !== "string" || signedRequest.length > 8192) return null;
  const parts = signedRequest.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  const [sigB64, payloadB64] = parts;
  const expected = createHmac("sha256", appSecret).update(payloadB64).digest();
  const got = b64urlDecode(sigB64);
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return null;
  let payload: SignedRequestPayload;
  try { payload = JSON.parse(b64urlDecode(payloadB64).toString("utf8")); } catch { return null; }
  if (!payload || typeof payload !== "object") return null;
  if (String(payload.algorithm ?? "").toUpperCase() !== "HMAC-SHA256") return null;
  if (typeof payload.user_id !== "string" && typeof payload.user_id !== "number") return null;
  return { ...payload, user_id: String(payload.user_id) };
}

export type MetaDeletionResponse =
  | { ok: true; userId: string; url: string; confirmation_code: string }
  | { ok: false; error: "not_configured" | "invalid_signed_request" };

/**
 * Pure part (no DB): validate the signed_request and build Meta's response. The confirmation code is derived (HMAC)
 * from the user id + issued_at, so it is stable for retries and does not reveal the id.
 */
export function buildMetaDeletionResponse(
  signedRequest: string,
  opts: { appSecret?: string; baseUrl?: string } = {},
): MetaDeletionResponse {
  const secret = opts.appSecret ?? process.env.META_APP_SECRET ?? "";
  if (!secret) return { ok: false, error: "not_configured" };
  const p = parseSignedRequest(signedRequest, secret);
  if (!p || !p.user_id) return { ok: false, error: "invalid_signed_request" };
  const userId = String(p.user_id);
  const code = createHmac("sha256", secret).update(`deletion|${userId}|${p.issued_at ?? ""}`).digest("hex").slice(0, 20).toUpperCase();
  const base = (opts.baseUrl ?? process.env.PUBLIC_URL ?? "http://localhost:3000").replace(/\/+$/, "");
  return { ok: true, userId, url: `${base}/api/webhooks/meta/data-deletion?code=${code}`, confirmation_code: code };
}

export class MetaDeletionError extends Error {
  constructor(public code: "not_configured" | "invalid_signed_request") { super(code); this.name = "MetaDeletionError"; }
}

/**
 * Route entry point: validate, delete matching Messenger/Instagram data in every tenant (legal-hold conversations are
 * kept and reviewed by a person), audit with the confirmation code only, and return Meta's {url, confirmation_code}.
 * Throws MetaDeletionError when the secret is missing or the signed_request is invalid (route answers 400).
 */
export function handleMetaDataDeletion(signedRequest: string, opts: { appSecret?: string; baseUrl?: string } = {}): { url: string; confirmation_code: string } {
  const r = buildMetaDeletionResponse(signedRequest, opts);
  if (!r.ok) throw new MetaDeletionError(r.error);
  const rows = getDb().prepare(
    "SELECT DISTINCT tenant_id, channel FROM conversations WHERE external_id = ? AND channel IN ('messenger','instagram')",
  ).all(r.userId) as { tenant_id: string; channel: string }[];
  for (const row of rows) deleteCustomerData(row.tenant_id, row.channel, r.userId, { actor: "meta-deletion" });
  audit(rows[0]?.tenant_id ?? "system", "meta-deletion", "privacy.meta_deletion_request",
    JSON.stringify({ confirmation_code: r.confirmation_code, matched: rows.length }));
  return { url: r.url, confirmation_code: r.confirmation_code };
}

/** For the status page: was this confirmation code received? (audit lookup, no PII). */
export function deletionStatus(code: string): "received" | "unknown" {
  if (!/^[A-F0-9]{20}$/.test(code)) return "unknown";
  const row = getDb().prepare("SELECT 1 FROM audit_log WHERE action = 'privacy.meta_deletion_request' AND detail LIKE ? LIMIT 1")
    .get(`%"confirmation_code":"${code}"%`);
  return row ? "received" : "unknown";
}
