// Session types shared by both backends + the pure tenant-selection rule.
import type { Role } from "./roles";
export type { Role };

export interface TenantMembership { id: string; name: string; role: Role }
export interface Session {
  userId: string;
  /** Active tenant. Always one of `tenants` (never taken from a cookie without checking the membership). */
  tenantId: string;
  /** Role in the active tenant. */
  role: Role;
  name: string;
  email: string;
  /** Every tenant this user belongs to (the sidebar switcher shows them when there is more than one). */
  tenants: TenantMembership[];
}
export interface AuthUser { id: string; email: string; name: string }
export type AuthState =
  | { status: "anonymous" }
  /**
   * Signed in without a usable tenant. `suspended`: every tenant the user belongs to is suspended (L1); show
   * "tu negocio está suspendido" instead of onboarding (the create_tenant RPC also refuses suspended owners).
   */
  | { status: "no_tenant"; user: AuthUser; suspended?: boolean }
  | { status: "ok"; session: Session };

/**
 * The active-tenant cookie is only a preference. It is honoured when it names one of the user's memberships;
 * anything else (forged, stale, removed membership) falls back to the first membership. No membership -> null.
 */
export function pickActiveTenant(memberships: TenantMembership[], cookieValue: string | null | undefined): TenantMembership | null {
  if (!memberships.length) return null;
  return (cookieValue && memberships.find((m) => m.id === cookieValue)) || memberships[0];
}

export function toSession(user: AuthUser, memberships: TenantMembership[], cookieValue: string | null | undefined): AuthState {
  const active = pickActiveTenant(memberships, cookieValue);
  if (!active) return { status: "no_tenant", user };
  return {
    status: "ok",
    session: { userId: user.id, tenantId: active.id, role: active.role, name: user.name, email: user.email, tenants: memberships },
  };
}
