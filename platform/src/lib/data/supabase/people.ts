// Tenants, members and users (Supabase). People live in Supabase Auth (auth.users) + public.tenant_members.
// Local password login (users.findLoginByEmail / create / setPasswordHash) is NOT offered here: Supabase Auth owns
// passwords (stage 3), so those methods fail with a clear DataBackendUnsupportedError instead of half-working.
import { DataBackendUnsupportedError, DataValidationError } from "../errors";
import { tenantListArgs, usagePeriod } from "../rules";
import type { Member, MembersRepo, PlatformAdminsRepo, TenantsRepo, UsersRepo } from "../types";
import { isUuid, scoped, type Db } from "./client";
import { count, mapRole, mapTenant, mapTenantOverview, obj, one, rows, run, TENANT_COLUMNS, userName } from "./map";

const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;

export function tenantsRepo(db: Db): TenantsRepo {
  return {
    async get(tenantId) {
      if (!isUuid(tenantId)) return null;
      const r = await one(db.from("tenants").select(TENANT_COLUMNS).eq("id", tenantId).maybeSingle(), "tenants.get");
      return r ? mapTenant(r) : null;
    },
    // CROSS-TENANT by design (platform-admin screen; the caller checked platformAdmins first). One RPC computes the
    // page and its counts in SQL (migration 20261120002400_platform_tenant_overview.sql, service_role only).
    async listAll(q = {}) {
      const { limit, offset, search } = tenantListArgs(q);
      const period = usagePeriod(q.now ?? new Date());
      const r = obj((await run(db.rpc("platform_tenant_overview", {
        p_period: period, p_search: search || null, p_limit: limit, p_offset: offset,
      }), "tenants.listAll")).data);
      const items = Array.isArray(r.items) ? (r.items as Record<string, unknown>[]).map(mapTenantOverview) : [];
      return { items, total: Number(r.total ?? 0), period };
    },
    async ensure(idOrSlug, name) {
      if (isUuid(idOrSlug)) {
        const r = await one(db.from("tenants").select("id").eq("id", idOrSlug).maybeSingle(), "tenants.ensure");
        if (!r) throw new DataValidationError("tenantId"); // cannot invent a uuid id: pass a slug to create one
        return r.id as string;
      }
      const slug = idOrSlug.trim().toLowerCase();
      if (!SLUG.test(slug)) throw new DataValidationError("slug");
      await run(db.from("tenants").upsert({ name: name.trim().slice(0, 120) || slug, slug }, { onConflict: "slug", ignoreDuplicates: true }), "tenants.ensure");
      const r = await one(db.from("tenants").select("id").eq("slug", slug).maybeSingle(), "tenants.ensure");
      if (!r) throw new DataValidationError("slug");
      return r.id as string;
    },
  };
}

async function authUser(db: Db, userId: string): Promise<{ email: string; name: string } | null> {
  const { data, error } = await db.auth.admin.getUserById(userId);
  if (error || !data?.user) return null;
  return { email: String(data.user.email ?? ""), name: userName(data.user.user_metadata) };
}

export function membersRepo(db: Db): MembersRepo {
  return {
    async list(tenantId) {
      const s = scoped(db, tenantId);
      const ms = await rows(s.from("tenant_members").select("user_id, role, created_at").order("created_at").order("user_id"), "members.list");
      return Promise.all(ms.map(async (m): Promise<Member> => {
        const u = await authUser(db, m.user_id as string);
        return { userId: m.user_id as string, tenantId: s.tenantId, name: u?.name ?? "", email: u?.email ?? "", role: mapRole(m.role) };
      }));
    },
  };
}

export function platformAdminsRepo(db: Db): PlatformAdminsRepo {
  return {
    // CROSS-TENANT (global role): public.platform_admins, read with the service role.
    async isPlatformAdmin(userId) {
      if (!isUuid(userId)) return false;
      return !!(await one(db.from("platform_admins").select("user_id").eq("user_id", userId).maybeSingle(), "platformAdmins.isPlatformAdmin"));
    },
  };
}

const NO_LOCAL_LOGIN = (m: string) =>
  new DataBackendUnsupportedError(`users.${m} is local (SQLite) login only; with DATA_BACKEND=supabase passwords are handled by Supabase Auth.`);

export function usersRepo(db: Db): UsersRepo {
  return {
    // CROSS-TENANT by design (first-run seed check): number of memberships across all tenants.
    async count() {
      return count(db.from("tenant_members").select("user_id", { count: "exact", head: true }), "users.count");
    },
    async findLoginByEmail() { throw NO_LOCAL_LOGIN("findLoginByEmail"); },
    // CROSS-TENANT by user id: the auth user plus their oldest membership (their default tenant).
    async get(userId) {
      if (!isUuid(userId)) return null;
      const u = await authUser(db, userId);
      if (!u) return null;
      const m = await rows(db.from("tenant_members").select("tenant_id").eq("user_id", userId).order("created_at").limit(1), "users.get");
      if (!m.length) return null;
      return { id: userId, tenantId: m[0].tenant_id as string, name: u.name, email: u.email };
    },
    async create() { throw NO_LOCAL_LOGIN("create"); },
    async setPasswordHash() { throw NO_LOCAL_LOGIN("setPasswordHash"); },
  };
}
