// Rotate an admin password: `npm run set-password -- admin@chefman.local`
// Generates a strong random password, stores only its scrypt hash and prints it ONCE. Nothing is written to .env.local.
import crypto from "node:crypto";
import { loadApp } from "./lib/bootstrap.mjs";

const email = (process.argv[2] ?? "").trim().toLowerCase();
if (!email) {
  console.error("Usage: npm run set-password -- <admin email>");
  process.exit(2);
}
const { getDb } = await loadApp("lib/db.ts");
const db = getDb();
const user = db.prepare("SELECT id, tenant_id FROM users WHERE email = ?").get(email);
if (!user) {
  console.error("No user with that email.");
  process.exit(1);
}
const password = crypto.randomBytes(15).toString("base64url");
const salt = crypto.randomBytes(16).toString("hex");
const hash = `${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`; // same format as src/lib/auth.ts
db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(hash, user.id);
db.prepare("INSERT INTO audit_log (id, tenant_id, actor, action, detail) VALUES (?,?,?,?,?)")
  .run(crypto.randomUUID(), user.tenant_id, "cli", "auth.password_rotated", user.id);
console.log(`New password for ${email}: ${password}`);
console.log("Save it in your password manager now. It is not stored anywhere in clear text.");
