// Tenants, members, platform admins and the local users table (SQLite).
import { newId } from "../../ids";
import { TENANT_DEFAULTS, tenantListArgs, usagePeriod } from "../rules";
import type {
  Member, MemberRole, MembersRepo, PlatformAdminsRepo, TenantInfo, TenantOverview, TenantPlan, TenantsRepo, TenantStatus, UsersRepo,
} from "../types";
import { db, type Row } from "./conn";

/** SQLite datetime('now') ("YYYY-MM-DD HH:MM:SS", UTC) -> ISO-Z like the rest of the app. */
export const sqliteIso = (v: unknown): string => {
  const s = String(v ?? "");
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? `${s.replace(" ", "T")}.000Z` : s;
};
const PLANS: readonly string[] = ["free", "pro", "business"];
const STATUSES: readonly string[] = ["active", "suspended", "deleted"];

function mapTenant(r: Row): TenantInfo {
  return {
    id: r.id as string, name: String(r.name ?? ""), slug: String(r.slug || r.id),
    plan: (PLANS.includes(String(r.plan)) ? r.plan : TENANT_DEFAULTS.plan) as TenantPlan,
    status: (STATUSES.includes(String(r.status)) ? r.status : TENANT_DEFAULTS.status) as TenantStatus,
    aiMonthlyTokenCap: Number(r.ai_monthly_token_cap ?? TENANT_DEFAULTS.aiMonthlyTokenCap),
    createdAt: sqliteIso(r.created_at),
  };
}
const TENANT_COLS = "t.id, t.name, t.slug, t.plan, t.status, t.ai_monthly_token_cap, t.created_at";
const likeArg = (s: string) => `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export const tenants: TenantsRepo = {
  async get(tenantId) {
    const r = db().prepare(`SELECT ${TENANT_COLS} FROM tenants t WHERE t.id = ?`).get(tenantId) as Row | undefined;
    return r ? mapTenant(r) : null;
  },
  async isActive(tenantId) {
    if (typeof tenantId !== "string" || !tenantId) return false;
    const r = db().prepare("SELECT status FROM tenants WHERE id = ?").get(tenantId) as Row | undefined;
    return !r || String(r.status ?? "active") === "active"; // no row: legacy single-tenant on-prem DB
  },
  async ensure(tenantId, name) {
    db().prepare("INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)").run(tenantId, name);
    return tenantId;
  },
  // CROSS-TENANT by design (platform-admin screen): the caller checked platformAdmins.isPlatformAdmin first.
  async listAll(q = {}) {
    const { limit, offset, search } = tenantListArgs(q);
    const period = usagePeriod(q.now ?? new Date());
    const pat = search ? likeArg(search) : null;
    const where = "(? IS NULL OR t.name LIKE ? ESCAPE '\\' OR COALESCE(t.slug, t.id) LIKE ? ESCAPE '\\')";
    const d = db();
    const total = Number((d.prepare(`SELECT COUNT(*) AS n FROM tenants t WHERE ${where}`).get(pat, pat, pat) as { n: number }).n);
    const rows = d.prepare(
      `SELECT ${TENANT_COLS},
         (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id) AS members,
         (SELECT COUNT(*) FROM conversations c WHERE c.tenant_id = t.id AND c.channel <> 'simulator'
            AND julianday(c.last_message_at) >= julianday(?)) AS conversations_this_month,
         (SELECT COUNT(*) FROM channel_accounts ch WHERE ch.tenant_id = t.id AND ch.status = 'connected') AS connected_channels,
         (SELECT COALESCE(SUM(a.input_tokens + a.output_tokens), 0) FROM ai_usage a WHERE a.tenant_id = t.id AND a.period = ?) AS ai_tokens
       FROM tenants t WHERE ${where} ORDER BY t.created_at DESC, t.id LIMIT ? OFFSET ?`,
    ).all(period, period, pat, pat, pat, limit, offset) as Row[];
    const items = rows.map((r): TenantOverview => ({
      ...mapTenant(r), members: Number(r.members ?? 0), conversationsThisMonth: Number(r.conversations_this_month ?? 0),
      connectedChannels: Number(r.connected_channels ?? 0), aiTokensThisMonth: Number(r.ai_tokens ?? 0),
    }));
    return { items, total, period };
  },
};

/** PLATFORM_ADMIN_EMAILS="a@x.com, b@y.com" (SQLite mode only). */
export const platformAdminEmails = (env: Record<string, string | undefined> = process.env): Set<string> =>
  new Set(String(env.PLATFORM_ADMIN_EMAILS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@")));

export const platformAdmins: PlatformAdminsRepo = {
  async isPlatformAdmin(userId) {
    const allowed = platformAdminEmails();
    if (!allowed.size || typeof userId !== "string" || !userId) return false;
    const r = db().prepare("SELECT email FROM users WHERE id = ?").get(userId) as Row | undefined;
    return !!r && allowed.has(String(r.email ?? "").toLowerCase());
  },
};

const role = (r: unknown): MemberRole => (r === "owner" || r === "agent" ? r : "admin");

export const members: MembersRepo = {
  async list(tenantId) {
    return (db().prepare("SELECT id, tenant_id, name, email, role FROM users WHERE tenant_id = ? ORDER BY created_at, id").all(tenantId) as Row[])
      .map((r): Member => ({ userId: r.id as string, tenantId: r.tenant_id as string, name: r.name as string, email: r.email as string, role: role(r.role) }));
  },
};

export const users: UsersRepo = {
  async count() {
    return Number((db().prepare("SELECT COUNT(*) c FROM users").get() as { c: number }).c);
  },
  async findLoginByEmail(email) {
    const r = db().prepare("SELECT id, tenant_id, password_hash FROM users WHERE email = ?").get(email) as Row | undefined;
    return r ? { id: r.id as string, tenantId: r.tenant_id as string, passwordHash: r.password_hash as string } : null;
  },
  async get(userId) {
    const r = db().prepare("SELECT id, tenant_id, name, email FROM users WHERE id = ?").get(userId) as Row | undefined;
    return r ? { id: r.id as string, tenantId: r.tenant_id as string, name: r.name as string, email: r.email as string } : null;
  },
  async create(u) {
    const id = u.id ?? newId();
    db().prepare("INSERT INTO users (id, tenant_id, email, name, password_hash, role) VALUES (?,?,?,?,?,?)")
      .run(id, u.tenantId, u.email, u.name, u.passwordHash, u.role ?? "admin");
    return id;
  },
  async setPasswordHash(userId, passwordHash) {
    return Number(db().prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, userId).changes) > 0;
  },
};
