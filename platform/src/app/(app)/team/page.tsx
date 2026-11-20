// Equipo: members with roles, invitations (Supabase mode). SQLite mode shows the local users read-only.
import { requireAdminPage } from "@/components/guards";
import { hasRole } from "@/lib/auth";
import { authBackend } from "@/lib/auth/backend";
import { getData } from "@/lib/data";
import { getLocale, makeT } from "@/lib/i18n";
import { shellDict } from "@/lib/shell-dict";
import { PageHeader } from "@/components/ui";
import { TeamClient, type TeamRow, type InviteRow } from "./TeamClient";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const s = await requireAdminPage(); // agents are redirected to /inbox before anything renders
  const t = makeT(shellDict, await getLocale());
  const canManage = hasRole(s.role, "admin");
  const supabase = authBackend() === "supabase";

  let members: TeamRow[] = [];
  let invites: InviteRow[] = [];
  if (supabase) {
    const [{ createSupabaseServerClient }, { listTeamDirectory, listPendingInvites }] = await Promise.all([
      import("@/lib/auth/supabase-server"), import("@/lib/auth/team"),
    ]);
    // Directory (names + emails) server side, after the session proved membership of the active tenant.
    members = (await listTeamDirectory(s)).map((m) => ({
      userId: m.userId, role: m.role, isYou: m.userId === s.userId,
      name: m.name || (m.userId === s.userId ? s.name : null), email: m.email || (m.userId === s.userId ? s.email : null),
    }));
    if (canManage) invites = await listPendingInvites(await createSupabaseServerClient(), s.tenantId);
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
