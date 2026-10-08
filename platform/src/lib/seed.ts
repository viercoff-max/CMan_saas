// Creates the first tenant + admin from .env.local if the DB is empty. Called on login and in the app shell.
import { getDb } from "./db";
import { hashPassword } from "./auth";
import { newId } from "./ids";
import { getAgentSettings } from "./store";

export function ensureSeed(): void {
  const db = getDb();
  const n = (db.prepare("SELECT COUNT(*) c FROM users").get() as { c: number }).c;
  if (n > 0) {
    // H3: the seed password should not stay in plain text on disk once the admin exists.
    const g = globalThis as { __seedWarned?: boolean };
    if (process.env.ADMIN_PASSWORD && !g.__seedWarned) {
      g.__seedWarned = true;
      console.warn("[seed] Admin already exists: remove ADMIN_PASSWORD from .env.local (see docs/RUNBOOK.md).");
    }
    return;
  }
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !password) throw new Error("ADMIN_EMAIL / ADMIN_PASSWORD missing. Run: npm run setup");
  const tenantId = "chefman";
  db.prepare("INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)").run(tenantId, process.env.TENANT_NAME ?? "Chefman");
  db.prepare("INSERT INTO users (id, tenant_id, email, name, password_hash) VALUES (?,?,?,?,?)")
    .run(newId(), tenantId, email, "Admin", hashPassword(password));
  getAgentSettings(tenantId);
}
export function getTenantName(tenantId: string): string {
  const r = getDb().prepare("SELECT name FROM tenants WHERE id = ?").get(tenantId) as { name: string } | undefined;
  return r?.name ?? tenantId;
}
