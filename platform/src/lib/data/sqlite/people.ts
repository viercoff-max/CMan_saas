// Tenants, members and the local users table (SQLite).
import { newId } from "../../ids";
import type { Member, MemberRole, MembersRepo, TenantsRepo, UsersRepo } from "../types";
import { db, type Row } from "./conn";

export const tenants: TenantsRepo = {
  async get(tenantId) {
    const r = db().prepare("SELECT id, name FROM tenants WHERE id = ?").get(tenantId) as Row | undefined;
    return r ? { id: r.id as string, name: r.name as string } : null;
  },
  async ensure(tenantId, name) {
    db().prepare("INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)").run(tenantId, name);
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
