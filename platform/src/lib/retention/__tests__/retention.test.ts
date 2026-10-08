import { DATA_DIR, FAKE_CWD } from "./env";
import fs from "node:fs";
import path from "node:path";
import { createHmac } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../../db";
import { purgeOldData, deleteCustomerData, exportCustomerData, MASKED_BODY } from "../index";
import { buildMetaDeletionResponse, handleMetaDataDeletion, parseSignedRequest, deletionStatus, MetaDeletionError } from "../meta-deletion";
import { hashKey, recordLoginFailure, countLoginFailures } from "../../security/rate-limit";

const NOW = new Date("2026-10-05T12:00:00.000Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000).toISOString();
const OUTBOX = path.join(DATA_DIR, "outbox");
const LEGACY_OUTBOX = path.join(FAKE_CWD, "data", "outbox");

let n = 0;
function conv(t: string, opts: { channel?: string; ext?: string; reason?: string | null; lastDaysAgo: number; msgDaysAgo?: number[]; body?: string }) {
  const db = getDb();
  const id = `conv-${++n}`;
  db.prepare("INSERT INTO conversations (id, tenant_id, channel, external_id, customer_name, escalation_reason, last_message_at, created_at) VALUES (?,?,?,?,?,?,?,?)")
    .run(id, t, opts.channel ?? "messenger", opts.ext ?? `ext-${n}`, "Ana", opts.reason ?? null, daysAgo(opts.lastDaysAgo), daysAgo(opts.lastDaysAgo));
  for (const d of opts.msgDaysAgo ?? [opts.lastDaysAgo])
    db.prepare("INSERT INTO messages (id, conversation_id, tenant_id, direction, sender, body, created_at) VALUES (?,?,?,?,?,?,?)")
      .run(`m-${id}-${d}-${Math.random()}`, id, t, "in", "customer", opts.body ?? "hola ana@example.com", daysAgo(d));
  return id;
}
const exists = (id: string) => !!getDb().prepare("SELECT 1 FROM conversations WHERE id = ?").get(id);
const msgCount = (id: string) => (getDb().prepare("SELECT COUNT(*) c FROM messages WHERE conversation_id = ?").get(id) as { c: number }).c;
function outbox(dir: string, name: string, text: string, ageDays = 0) {
  fs.mkdirSync(dir, { recursive: true });
  const f = path.join(dir, name);
  fs.writeFileSync(f, text);
  const t = new Date(NOW.getTime() - ageDays * 86_400_000);
  fs.utimesSync(f, t, t);
  return f;
}

beforeEach(() => {
  const db = getDb();
  for (const t of ["messages", "conversations", "audit_log"]) db.exec(`DELETE FROM ${t}`);
  fs.rmSync(OUTBOX, { recursive: true, force: true });
  fs.rmSync(LEGACY_OUTBOX, { recursive: true, force: true });
});

describe("purgeOldData", () => {
  it("deletes conversations idle longer than 90 days, keeps recent ones", () => {
    const old = conv("t1", { lastDaysAgo: 120 });
    const recent = conv("t1", { lastDaysAgo: 10 });
    const r = purgeOldData(undefined, NOW);
    expect(exists(old)).toBe(false);
    expect(msgCount(old)).toBe(0);
    expect(exists(recent)).toBe(true);
    expect(r.conversationsDeleted).toBe(1);
    expect(r.retentionDays).toBe(90);
  });

  it("removes old messages inside an active conversation", () => {
    const c = conv("t1", { lastDaysAgo: 1, msgDaysAgo: [200, 100, 1] });
    purgeOldData("t1", NOW);
    expect(exists(c)).toBe(true);
    expect(msgCount(c)).toBe(1);
  });

  it("keeps safety/legal conversations (legal hold) and masks bodies only after 365 days", () => {
    const safety = conv("t1", { reason: "safety", lastDaysAgo: 200 });
    const legal = conv("t1", { reason: "legal", lastDaysAgo: 400, msgDaysAgo: [400, 300] });
    const r = purgeOldData(undefined, NOW);
    expect(exists(safety)).toBe(true);
    expect(exists(legal)).toBe(true);
    expect(msgCount(legal)).toBe(2);
    const bodies = (getDb().prepare("SELECT body, created_at FROM messages WHERE conversation_id = ? ORDER BY created_at").all(legal) as { body: string }[]).map((m) => m.body);
    expect(bodies[0]).toBe(MASKED_BODY);
    expect(bodies[1]).not.toBe(MASKED_BODY);
    expect(r.messagesMasked).toBe(1);
    // idempotent
    expect(purgeOldData(undefined, NOW).messagesMasked).toBe(0);
  });

  it("respects RETENTION_DAYS but never below 30", () => {
    const c = conv("t1", { lastDaysAgo: 20 });
    process.env.RETENTION_DAYS = "7";
    try { purgeOldData(undefined, NOW); } finally { delete process.env.RETENTION_DAYS; }
    expect(exists(c)).toBe(true);
  });

  it("is tenant scoped", () => {
    const a = conv("t1", { lastDaysAgo: 120 });
    const b = conv("t2", { lastDaysAgo: 120 });
    purgeOldData("t1", NOW);
    expect(exists(a)).toBe(false);
    expect(exists(b)).toBe(true);
  });

  it("purges outbox files older than 30 days (both outbox folders) and files of purged conversations", () => {
    const keep = conv("t1", { lastDaysAgo: 1 });
    const gone = conv("t1", { lastDaysAgo: 120 });
    const oldFile = outbox(OUTBOX, `2026-01-01-${keep}.txt`, "x", 40);
    const oldLegacy = outbox(LEGACY_OUTBOX, "legacy.txt", "x", 40);
    const freshFile = outbox(OUTBOX, `2026-10-01-${keep}.txt`, "x", 1);
    const goneFile = outbox(OUTBOX, `2026-10-02-${gone}.txt`, "x", 1);
    purgeOldData(undefined, NOW);
    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(oldLegacy)).toBe(false);
    expect(fs.existsSync(freshFile)).toBe(true);
    expect(fs.existsSync(goneFile)).toBe(false);
  });

  it("drops login-attempt rows older than 24 h", () => {
    const k = hashKey("login-email", "x@example.com");
    recordLoginFailure([k], NOW.getTime() - 2 * 86_400_000);
    recordLoginFailure([k], NOW.getTime() - 60_000);
    const r = purgeOldData(undefined, NOW);
    expect(r.securityRowsDeleted).toBeGreaterThanOrEqual(1);
    expect(countLoginFailures(k, NOW.getTime())).toBe(1);
  });

  it("audit rows carry counts only (no message text or emails)", () => {
    conv("t1", { lastDaysAgo: 120 });
    purgeOldData(undefined, NOW);
    const rows = getDb().prepare("SELECT detail FROM audit_log WHERE action = 'retention.purge'").all() as { detail: string }[];
    expect(rows.length).toBe(1);
    expect(rows[0].detail).not.toMatch(/@|hola|Ana/);
  });
});

describe("deleteCustomerData / exportCustomerData", () => {
  it("exports then deletes one identity, its outbox files, and audits without PII", () => {
    const c = conv("t1", { channel: "instagram", ext: "IG-123", lastDaysAgo: 1 });
    const other = conv("t1", { channel: "instagram", ext: "IG-999", lastDaysAgo: 1 });
    const f1 = outbox(OUTBOX, `a-${c}.txt`, "Abrir: https://inbox.test/inbox?c=" + c);
    const f2 = outbox(OUTBOX, `b-${other}.txt`, "other");

    const ex = exportCustomerData("t1", "instagram", "IG-123", { now: NOW });
    expect(ex.conversations).toHaveLength(1);
    expect(ex.conversations[0].messages[0].body).toContain("hola");

    const r = deleteCustomerData("t1", "instagram", "IG-123");
    expect(r).toMatchObject({ conversations: 1, messages: 1, outboxFiles: 1, heldConversations: 0 });
    expect(exists(c)).toBe(false);
    expect(exists(other)).toBe(true);
    expect(fs.existsSync(f1)).toBe(false);
    expect(fs.existsSync(f2)).toBe(true);
    const detail = (getDb().prepare("SELECT detail FROM audit_log WHERE action = 'privacy.customer_deleted'").get() as { detail: string }).detail;
    expect(detail).not.toContain("IG-123");
    expect(detail).not.toContain("Ana");
  });

  it("does not delete a legal-hold conversation unless forced", () => {
    const c = conv("t1", { channel: "messenger", ext: "PSID-1", reason: "legal", lastDaysAgo: 1 });
    expect(deleteCustomerData("t1", "messenger", "PSID-1").heldConversations).toBe(1);
    expect(exists(c)).toBe(true);
    expect(deleteCustomerData("t1", "messenger", "PSID-1", { force: true }).conversations).toBe(1);
    expect(exists(c)).toBe(false);
  });

  it("never crosses tenants", () => {
    const a = conv("t1", { ext: "same", lastDaysAgo: 1 });
    const b = conv("t2", { ext: "same", lastDaysAgo: 1 });
    deleteCustomerData("t1", "messenger", "same");
    expect(exists(a)).toBe(false);
    expect(exists(b)).toBe(true);
  });
});

describe("Meta data deletion callback", () => {
  const SECRET = "meta-app-secret-xyz";
  const b64u = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  function signed(payload: object, secret = SECRET) {
    const p = b64u(Buffer.from(JSON.stringify(payload)));
    return `${b64u(createHmac("sha256", secret).update(p).digest())}.${p}`;
  }

  it("parses a valid signed_request", () => {
    expect(parseSignedRequest(signed({ algorithm: "HMAC-SHA256", user_id: "123", issued_at: 1 }), SECRET)?.user_id).toBe("123");
  });
  it("rejects bad signature, wrong algorithm, malformed input and missing secret", () => {
    expect(parseSignedRequest(signed({ algorithm: "HMAC-SHA256", user_id: "1" }, "other"), SECRET)).toBeNull();
    expect(parseSignedRequest(signed({ algorithm: "none", user_id: "1" }), SECRET)).toBeNull();
    expect(parseSignedRequest("garbage", SECRET)).toBeNull();
    expect(parseSignedRequest("a.b.c", SECRET)).toBeNull();
    expect(buildMetaDeletionResponse(signed({ algorithm: "HMAC-SHA256", user_id: "1" }), { appSecret: "" })).toEqual({ ok: false, error: "not_configured" });
    expect(() => handleMetaDataDeletion("x.y", { appSecret: SECRET })).toThrow(MetaDeletionError);
  });
  it("returns {url, confirmation_code}, stable across retries, without the user id in the URL", () => {
    const sr = signed({ algorithm: "HMAC-SHA256", user_id: "PSID-77", issued_at: 1700000000 });
    const a = buildMetaDeletionResponse(sr, { appSecret: SECRET, baseUrl: "https://inbox.test/" });
    const b = buildMetaDeletionResponse(sr, { appSecret: SECRET, baseUrl: "https://inbox.test" });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(a.confirmation_code).toMatch(/^[A-F0-9]{20}$/);
    expect(a.confirmation_code).toBe(b.confirmation_code);
    expect(a.url).toBe(`https://inbox.test/api/webhooks/meta/data-deletion?code=${a.confirmation_code}`);
    expect(a.url).not.toContain("PSID-77");
  });
  it("handleMetaDataDeletion deletes matching messenger/instagram data, returns {url, confirmation_code} and records a status", () => {
    const c = conv("t1", { channel: "messenger", ext: "PSID-77", lastDaysAgo: 1 });
    const r = handleMetaDataDeletion(signed({ algorithm: "HMAC-SHA256", user_id: "PSID-77", issued_at: 5 }), { appSecret: SECRET });
    expect(Object.keys(r).sort()).toEqual(["confirmation_code", "url"]);
    expect(exists(c)).toBe(false);
    expect(deletionStatus(r.confirmation_code)).toBe("received");
    const audit = getDb().prepare("SELECT detail FROM audit_log WHERE action = 'privacy.meta_deletion_request'").get() as { detail: string };
    expect(audit.detail).not.toContain("PSID-77");
    expect(deletionStatus("ABCDEF0123456789ABCD")).toBe("unknown");
  });
});
