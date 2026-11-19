// Equipo: members with roles, invitations (Supabase mode). SQLite mode shows the local users read-only.
import { redirect } from "next/navigation";
import { getSession, hasRole } from "@/lib/auth";
import { authBackend } from "@/lib/auth/backend";
import { getData } from "@/lib/data";
import { getLocale, makeT } from "@/lib/i18n";
import { shellDict } from "@/lib/shell-dict";
import { PageHeader } from "@/components/ui";
import { TeamClient, type TeamRow, type InviteRow } from "./TeamClient";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  const t = makeT(shellDict, await getLocale());
  const canManage = hasRole(s.role, "admin");
  const supabase = authBackend() === "supabase";

  let members: TeamRow[] = [];
  let invites: InviteRow[] = [];
  if (supabase) {
    const [{ createSupabaseServerClient }, { listTeam, listPendingInvites }] = await Promise.all([
      import("@/lib/auth/supabase-server"), import("@/lib/auth/team"),
    ]);
    const client = await createSupabaseServerClient();
    // tenant_members has no name/email (auth.users is not readable with the user session): only "you" is named.
    members = (await listTeam(client, s.tenantId)).map((m) => ({
      userId: m.userId, role: m.role, isYou: m.userId === s.userId,
      name: m.userId === s.userId ? s.name : null, email: m.userId === s.userId ? s.email : null,
    }));
    if (canManage) invites = await listPendingInvites(client, s.tenantId);
  } else {
    members = (await getData().members.list(s.tenantId)).map((m) => ({ userId: m.userId, role: m.role, isYou: m.userId === s.userId, name: m.name, email: m.email }));
  }

  return (
    <>
      <PageHeader title={t("team.title")} subtitle={t("team.subtitle")} />
      <TeamClient members={members} invites={invites} canManage={canManage && supabase} isAdmin={canManage} supabase={supabase} />
    </>
  );
}
