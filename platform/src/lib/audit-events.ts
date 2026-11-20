// Server-side audit events for account, team and settings actions (both backends, written through getData().audit).
// One place for the action names so screens stay consistent. Details carry ids, roles, channel/add-on keys, counts
// and HASHES only: never emails, names, tokens, links, IPs in clear or message text.
// Writing an audit row must never make the user's action fail: auditEvent() swallows (and logs the code of) errors.
import { getData } from "./data";
import { AUDIT_GLOBAL_TENANT } from "./data/types";
import { hashKey } from "./security/rate-limit";

export const AUDIT = {
  loginOk: "auth.login_ok",
  loginFailed: "auth.login_failed",
  /** Written by the create_tenant RPC itself (SQL, with actor_user_id): do not log it again from the app. */
  tenantCreated: "tenant.create",
  inviteCreated: "team.invite_created",
  /** Written by the accept_invitation RPC itself (SQL, with actor_user_id): do not log it again from the app. */
  inviteAccepted: "invitation.accept",
  inviteRevoked: "team.invite_revoked",
  roleChanged: "team.role_changed",
  memberRemoved: "team.member_removed",
  /** Existing names used by channels/actions.ts and the Shopify routes. */
  channelConnected: "channel.connect",
  channelDisconnected: "channel.disconnect",
  addonConnected: "shopify.connected",
  addonDisconnected: "shopify.disconnected",
  /** Wave 2 branding screen: detail = the changed field names (e.g. "primaryColor,logoPath"). */
  brandSaved: "brand.save",
} as const;
export type AuditAction = (typeof AUDIT)[keyof typeof AUDIT];

/** Never throws. `tenantId` may be AUDIT_GLOBAL_TENANT for events without a tenant. */
export async function auditEvent(tenantId: string, actor: string, action: AuditAction | string, detail = ""): Promise<void> {
  try { await getData().audit.log(tenantId, actor, action, detail); }
  catch (e) { console.error(`[audit] ${action} not written:`, e instanceof Error ? e.name : "error"); }
}

/** HMAC-hashed client IP for audit details (same key family as the login limiter). */
export const auditIpHash = (ip: string): string => hashKey("login-ip", ip || "unknown");

/**
 * Supabase sign-in result. Success: one row per tenant the user belongs to (each tenant's admins see it), or a global
 * row when the user has no tenant yet. Failure: a global row (the email is never stored, not even hashed here).
 */
export async function auditSignIn(r: { ok: boolean; userId?: string | null; tenantIds?: string[] }, ip: string): Promise<void> {
  const ipHash = auditIpHash(ip);
  if (!r.ok || !r.userId) { await auditEvent(AUDIT_GLOBAL_TENANT, "anonymous", AUDIT.loginFailed, ipHash); return; }
  const tenants = (r.tenantIds ?? []).slice(0, 20);
  if (!tenants.length) { await auditEvent(AUDIT_GLOBAL_TENANT, r.userId, AUDIT.loginOk, ipHash); return; }
  for (const t of tenants) await auditEvent(t, r.userId, AUDIT.loginOk, ipHash);
}
