// Signed OAuth state cookie: `${nonce}.${tenantId}.${exp}.${sig}` (httpOnly). The callback has no session
// requirement, so tenant scoping comes from this signed value (set only by the authenticated /connect route).
import { randomBytes } from "node:crypto";
import { sign, safeEqual } from "../crypto";

export const STATE_COOKIE = "shopify_oauth";
export const STATE_TTL_S = 600;

export function newState(tenantId: string, shop: string): { state: string; cookie: string } {
  const state = randomBytes(16).toString("hex");
  const payload = `${state}.${tenantId}.${Date.now() + STATE_TTL_S * 1000}.${Buffer.from(shop).toString("base64url")}`;
  return { state, cookie: `${payload}.${sign(payload)}` };
}

export function readState(cookie: string | undefined): { state: string; tenantId: string; shop: string } | null {
  if (!cookie) return null;
  const parts = cookie.split(".");
  if (parts.length !== 5) return null;
  const [state, tenantId, exp, shopB64, sig] = parts;
  if (!safeEqual(sign(`${state}.${tenantId}.${exp}.${shopB64}`), sig) || Number(exp) < Date.now()) return null;
  return { state, tenantId, shop: Buffer.from(shopB64, "base64url").toString() };
}
