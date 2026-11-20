// Page-level role guards for Server Components (SERVER ONLY). Call at the very top of an admin page, before reading
// any data: the redirect is thrown before anything renders, so an agent who types /tone never sees its content.
// The sidebar already hides these pages for agents, and their actions/routes answer 403 on their own.
import { redirect } from "next/navigation";
import { getSession, hasRole, type Session } from "@/lib/auth";

/** Where a signed-in member without the admin role goes instead of an admin page. */
export const AGENT_HOME = "/inbox";

/** Pure rule (tested): null = may view; otherwise the path to redirect to. */
export function adminPageRedirect(s: Session | null): string | null {
  if (!s) return "/login";
  return hasRole(s.role, "admin") ? null : AGENT_HOME;
}

/** Signed-in owner/admin of the active tenant, or a redirect (anonymous -> /login, agent -> /inbox). */
export async function requireAdminPage(): Promise<Session> {
  const s = await getSession();
  const to = adminPageRedirect(s);
  if (to || !s) redirect(to ?? "/login");
  return s;
}

/** Any signed-in member, or /login. */
export async function requireMemberPage(): Promise<Session> {
  const s = await getSession();
  if (!s) redirect("/login");
  return s;
}
