// Roles of a tenant member (public.tenant_members.role): owner > admin > agent.
//   owner/admin: everything (settings, context, sources, channels, add-ons, team)
//   agent:       inbox (reply, take, return, resolve) and the simulator
export type Role = "owner" | "admin" | "agent";
const RANK: Record<Role, number> = { owner: 3, admin: 2, agent: 1 };

export function isRole(v: unknown): v is Role {
  return v === "owner" || v === "admin" || v === "agent";
}

/** True when `role` is at least `min` ("admin" accepts owner and admin). */
export function hasRole(role: unknown, min: Role): boolean {
  return isRole(role) && RANK[role] >= RANK[min];
}

export function forbiddenResponse(): Response {
  return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: { "content-type": "application/json" } });
}
export function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers: { "content-type": "application/json" } });
}
