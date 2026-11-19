// Tenants, members and users (Supabase). People live in Supabase Auth (auth.users) + public.tenant_members.
// Local password login (users.findLoginByEmail / create / setPasswordHash) is NOT offered here: Supabase Auth owns
// passwords (stage 3), so those methods fail with a clear DataBackendUnsupportedError instead of half-working.
import { DataBackendUnsupportedError, DataValidationError } from "../errors";
import type { Member, MembersRepo, TenantsRepo, UsersRepo } from "../types";
import { isUuid, scoped, type Db } from "./client";
import { count, mapRole, one, rows, run, userName } from "./map";

const SLUG = /^[a-z0-9][a-z0-9-]{1,62}$/;

export function tenantsRepo(db: Db): TenantsRepo {
  return {
    async get(tenantId) {
      if (!isUuid(tenantId)) return null;
      const r = await one(db.from("tenants").select("id, name").eq("id", tenantId).maybeSingle(), "tenants.get");
      return r ? { id: r.id as string, name: String(r.name ?? "") } : null;
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
