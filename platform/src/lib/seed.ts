// SQLite mode: creates the first tenant + admin from .env.local if the DB is empty. Called on login and in the app shell.
// Supabase mode: a no-op. Users live in Supabase Auth and tenants are created by onboarding (create_tenant RPC), so
// no local user, tenant or password is ever created here.
import { getData } from "./data";
import { hashPassword } from "./auth";

export async function ensureSeed(): Promise<void> {
  const data = getData();
  if (data.backend === "supabase") return;
  if ((await data.users.count()) > 0) {
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
  await data.tenants.ensure(tenantId, process.env.TENANT_NAME ?? "Chefman");
  await data.users.create({ tenantId, email, name: "Admin", passwordHash: hashPassword(password) });
  await data.settings.get(tenantId);
}
export async function getTenantName(tenantId: string): Promise<string> {
  return (await getData().tenants.get(tenantId))?.name ?? tenantId;
}
