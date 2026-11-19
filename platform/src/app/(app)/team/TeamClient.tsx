"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, ConfirmDialog, Field, inputCls } from "@/components/ui";
import { useLocale, useT } from "@/lib/i18n-client";
import { shellDict } from "@/lib/shell-dict";
import type { Role } from "@/lib/auth/session";
import { changeRoleAction, inviteMemberAction, removeMemberAction, revokeInviteAction } from "./actions";

export interface TeamRow { userId: string; role: Role; isYou: boolean; name: string | null; email: string | null }
export interface InviteRow { id: string; email: string; role: "admin" | "agent"; createdAt: string; expiresAt: string }

const initials = (s: string) => s.split(/[\s@.]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
const selectCls = "min-h-11 rounded-xl border border-line bg-surface px-3 text-sm text-ink focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/30";

export function TeamClient({ members, invites, canManage, isAdmin, supabase }: { members: TeamRow[]; invites: InviteRow[]; canManage: boolean; isAdmin: boolean; supabase: boolean }) {
  const t = useT(shellDict);
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState<TeamRow | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "agent">("agent");
  const [link, setLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const errText = (e: string) => t(e === "invalid" ? "team.errInvalid" : e === "forbidden" ? "team.errForbidden" : "team.errFailed");
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => {
    setError(null);
    try {
      const r = await fn();
      if (!r.ok) setError(errText(r.error ?? "failed"));
      router.refresh();
    } catch { setError(t("team.errForbidden")); }
  });
  const fmt = (iso: string) => { try { return new Date(iso).toLocaleDateString(locale === "en" ? "en-US" : "es-MX"); } catch { return iso; } };

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
      <Card className="p-0">
        <ul className="divide-y divide-line">
          {members.map((m) => {
            const label = m.name || m.email || t("team.member");
            const editable = canManage && !m.isYou && m.role !== "owner";
            return (
              <li key={m.userId} className="flex flex-wrap items-center gap-3 px-5 py-4">
                <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-canvas text-xs font-semibold text-muted">{initials(label)}</span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink">{label} {m.isYou && <Badge>{t("team.you")}</Badge>}</p>
                  {m.email && <p className="truncate text-xs text-muted">{m.email}</p>}
                </div>
                {editable ? (
                  <select aria-label={`${t("team.role")}: ${label}`} className={selectCls} value={m.role} disabled={pending}
                    onChange={(e) => { const r = e.target.value as "admin" | "agent"; run(() => changeRoleAction({ userId: m.userId, role: r })); }}>
                    <option value="admin">{t("role.admin")}</option>
                    <option value="agent">{t("role.agent")}</option>
                  </select>
                ) : (
                  <span className="text-sm text-muted">{t(`role.${m.role}`)}</span>
                )}
                {editable && <Button variant="ghost" disabled={pending} onClick={() => setRemoving(m)}>{t("team.remove")}</Button>}
              </li>
            );
          })}
          {invites.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
              <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-dashed border-line text-xs">✉️</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-ink">{i.email}</p>
                <p className="text-xs text-muted">{t("team.invitedAgo", { date: fmt(i.createdAt) })}</p>
              </div>
              <span className="text-sm text-muted">{t(`role.${i.role}`)}</span>
              <Badge tone="warn">{t("team.pending")}</Badge>
              {canManage && <Button variant="ghost" disabled={pending} onClick={() => run(() => revokeInviteAction({ id: i.id }))}>{t("team.revoke")}</Button>}
            </li>
          ))}
        </ul>
        <p className="border-t border-line px-5 py-3 text-xs text-muted">{t("team.legend")}</p>
      </Card>

      <div className="space-y-4">
        {!supabase ? (
          <Card><p className="text-sm text-muted">{t("team.sqlite")}</p></Card>
        ) : !isAdmin ? (
          <Card><p className="text-sm text-muted">{t("team.readOnly")}</p></Card>
        ) : (
          <Card>
            <h2 className="mb-3 text-base font-semibold">{t("team.inviteTitle")}</h2>
            <form className="space-y-3" onSubmit={(e) => {
              e.preventDefault();
              setLink(null); setCopied(false);
              start(async () => {
                setError(null);
                try {
                  const r = await inviteMemberAction({ email, role });
                  if (r.ok) { setLink(r.link); setEmail(""); router.refresh(); } else setError(errText(r.error));
                } catch { setError(t("team.errForbidden")); }
              });
            }}>
              <Field label={t("team.email")}><input type="email" required maxLength={320} value={email} onChange={(e) => setEmail(e.target.value)} placeholder="nombre@example.com" className={inputCls} /></Field>
              <Field label={t("team.role")}>
                <select value={role} onChange={(e) => setRole(e.target.value as "admin" | "agent")} className={`${selectCls} w-full`}>
                  <option value="agent">{t("role.agent")}</option>
                  <option value="admin">{t("role.admin")}</option>
                </select>
              </Field>
              <Button type="submit" className="w-full" disabled={pending}>{t("team.inviteSubmit")}</Button>
            </form>
            {link && (
              <div className="mt-4 rounded-xl border border-line bg-canvas p-3" role="status">
                <p className="text-sm font-semibold">{t("team.linkTitle")}</p>
                <p className="mt-1 text-xs text-muted">{t("team.linkBody")}</p>
                <input readOnly value={link} aria-label={t("team.linkTitle")} onFocus={(e) => e.currentTarget.select()} className={`${inputCls} mt-2 font-mono text-xs`} />
                <Button variant="secondary" className="mt-2 w-full" onClick={async () => {
                  try { await navigator.clipboard.writeText(link); setCopied(true); } catch { /* the field is selectable */ }
                }}>{copied ? t("team.copied") : t("team.copy")}</Button>
              </div>
            )}
          </Card>
        )}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </div>

      <ConfirmDialog open={!!removing} title={t("team.removeConfirm")} body={t("team.removeBody")}
        confirmLabel={t("team.remove")} cancelLabel={t("team.cancel")}
        onCancel={() => setRemoving(null)}
        onConfirm={() => { const m = removing; setRemoving(null); if (m) run(() => removeMemberAction({ userId: m.userId })); }} />
    </div>
  );
}
