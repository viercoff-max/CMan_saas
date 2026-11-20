// Shell navigation (pure, shared by the Sidebar and its tests). `admin`: hidden for agents. The pages themselves also
// redirect agents (components/guards.ts) and the actions / routes behind them answer 403, so hiding is only layer one.
import type { Role } from "@/lib/auth/roles";

export interface NavItem { href: string; key: string; icon: string; admin?: boolean }
export interface NavGroup { key: string; items: NavItem[] }

export const NAV_GROUPS: NavGroup[] = [
  { key: "nav.group.attention", items: [
    { href: "/dashboard", key: "nav.dashboard", icon: "🏠" },
    { href: "/inbox", key: "nav.inbox", icon: "💬" },
  ] },
  { key: "nav.group.assistant", items: [
    { href: "/context", key: "nav.context", icon: "📝", admin: true },
    { href: "/tone", key: "nav.tone", icon: "🎚️", admin: true },
    { href: "/sources", key: "nav.sources", icon: "🔗", admin: true },
  ] },
  { key: "nav.group.connections", items: [
    { href: "/channels", key: "nav.channels", icon: "📡", admin: true },
    { href: "/addons", key: "nav.addons", icon: "🧩", admin: true },
  ] },
  { key: "nav.group.business", items: [
    { href: "/brand", key: "nav.brand", icon: "🎨", admin: true },
    { href: "/team", key: "nav.team", icon: "👥", admin: true },
    { href: "/billing", key: "nav.billing", icon: "📊" },
  ] },
];

/** Paths an agent must not open (the page guards redirect them). */
export const ADMIN_PATHS = NAV_GROUPS.flatMap((g) => g.items).filter((i) => i.admin).map((i) => i.href);

/** The groups (and items) a role may see; empty groups are dropped. */
export function navFor(role: Role): NavGroup[] {
  const isAdmin = role === "owner" || role === "admin";
  return NAV_GROUPS.map((g) => ({ ...g, items: g.items.filter((i) => isAdmin || !i.admin) })).filter((g) => g.items.length > 0);
}
