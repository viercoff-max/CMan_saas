// Customers, internal notes and the conversation activity log (SQLite). Same rules as the Supabase backend:
// every statement is scoped by tenant_id; ids from another tenant are treated as "not found".
import { newId, nowIso } from "../../ids";
import type { Channel, ConversationEvent, ConversationEventKind, ConversationNote, Customer } from "../../types";
import { normalizeCustomerPatch } from "../rules";
import type { CustomerListItem, CustomersRepo, DashboardPrefsRepo, EventsRepo, NotesRepo } from "../types";
import { db, json, tx, type Row } from "./conn";

const tagsOf = (v: unknown): string[] => {
  try { const a = JSON.parse(String(v ?? "[]")); return Array.isArray(a) ? a.map(String) : []; } catch { return []; }
};
const mapCustomer = (r: Row): Customer => ({
  id: r.id as string, tenantId: r.tenant_id as string, name: String(r.name ?? ""), email: (r.email as string) ?? null,
  phone: (r.phone as string) ?? null, tags: tagsOf(r.tags), notes: String(r.notes ?? ""),
  createdAt: String(r.created_at ?? ""), updatedAt: String(r.updated_at ?? ""),
});
const getCustomer = (tenantId: string, id: string): Customer | null => {
  const r = db().prepare("SELECT * FROM customers WHERE tenant_id=? AND id=?").get(tenantId, id) as Row | undefined;
  return r ? mapCustomer(r) : null;
};

export const customers: CustomersRepo = {
  async list(tenantId, q = {}) {
    const limit = Math.max(1, Math.min(q.limit ?? 200, 1000));
    const where = ["c.tenant_id = ?"]; const args: (string | number)[] = [tenantId];
    if (q.search) {
      const pat = `%${q.search.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
      where.push("(c.name LIKE ? ESCAPE '\\' OR c.email LIKE ? ESCAPE '\\' OR c.phone LIKE ? ESCAPE '\\')");
      args.push(pat, pat, pat);
    }
    const rows = db().prepare(
      `SELECT c.*, COUNT(v.id) AS n, MAX(v.last_message_at) AS last_at, GROUP_CONCAT(DISTINCT v.channel) AS chans
       FROM customers c LEFT JOIN conversations v ON v.tenant_id = c.tenant_id AND v.customer_id = c.id
       WHERE ${where.join(" AND ")} GROUP BY c.id ORDER BY COALESCE(MAX(v.last_message_at), c.updated_at) DESC LIMIT ?`,
    ).all(...args, limit) as Row[];
    return rows.map((r): CustomerListItem => ({
      ...mapCustomer(r), conversations: Number(r.n ?? 0), lastMessageAt: (r.last_at as string) ?? null,
      channels: String(r.chans ?? "").split(",").filter(Boolean) as Channel[],
    }));
  },
  async get(tenantId, id) { return getCustomer(tenantId, id); },
  async create(tenantId, c) {
    const id = newId();
    db().prepare("INSERT INTO customers (id, tenant_id, name) VALUES (?,?,?)").run(id, tenantId, String(c.name ?? "").slice(0, 200));
    return getCustomer(tenantId, id)!;
  },
  async update(tenantId, id, patch) {
    if (!getCustomer(tenantId, id)) return null;
    const p = normalizeCustomerPatch(patch);
    const sets: string[] = []; const args: (string | null)[] = [];
    if (p.name !== undefined) { sets.push("name=?"); args.push(p.name); }
    if (p.email !== undefined) { sets.push("email=?"); args.push(p.email); }
    if (p.phone !== undefined) { sets.push("phone=?"); args.push(p.phone); }
    if (p.tags !== undefined) { sets.push("tags=?"); args.push(JSON.stringify(p.tags)); }
    if (p.notes !== undefined) { sets.push("notes=?"); args.push(p.notes); }
    sets.push("updated_at=?"); args.push(nowIso());
    db().prepare(`UPDATE customers SET ${sets.join(", ")} WHERE tenant_id=? AND id=?`).run(...args, tenantId, id);
    return getCustomer(tenantId, id);
  },
  async merge(tenantId, fromId, intoId) {
    if (fromId === intoId) return false;
    const from = getCustomer(tenantId, fromId), into = getCustomer(tenantId, intoId);
    if (!from || !into) return false;
    const d = db();
    return tx(d, () => {
      d.prepare("UPDATE conversations SET customer_id=? WHERE tenant_id=? AND customer_id=?").run(intoId, tenantId, fromId);
      const tags = [...new Set([...into.tags, ...from.tags])].slice(0, 20);
      const notes = [into.notes, from.notes].filter((s) => s.trim()).join("\n\n").slice(0, 4000);
      d.prepare("UPDATE customers SET tags=?, notes=?, name=CASE WHEN name='' THEN ? ELSE name END, email=COALESCE(email, ?), phone=COALESCE(phone, ?), updated_at=? WHERE tenant_id=? AND id=?")
        .run(JSON.stringify(tags), notes, from.name, from.email, from.phone, nowIso(), tenantId, intoId);
      d.prepare("DELETE FROM customers WHERE tenant_id=? AND id=?").run(tenantId, fromId);
      return true;
    });
  },
  async deleteOrphans(tenantId, minAgeMs = 10 * 60_000) {
    const cutoff = new Date(Date.now() - minAgeMs).toISOString();
    return Number(db().prepare(
      "DELETE FROM customers WHERE tenant_id=? AND julianday(created_at) <= julianday(?) AND NOT EXISTS (SELECT 1 FROM conversations v WHERE v.tenant_id = customers.tenant_id AND v.customer_id = customers.id)",
    ).run(tenantId, cutoff).changes);
  },
};

const mapNote = (r: Row): ConversationNote => ({
  id: r.id as string, conversationId: r.conversation_id as string, authorUserId: (r.author_user_id as string) ?? null,
  body: String(r.body ?? ""), createdAt: String(r.created_at ?? ""),
});

export const notes: NotesRepo = {
  async list(tenantId, conversationId) {
    return (db().prepare("SELECT * FROM conversation_notes WHERE tenant_id=? AND conversation_id=? ORDER BY created_at, rowid")
      .all(tenantId, conversationId) as Row[]).map(mapNote);
  },
  async add(tenantId, conversationId, n) {
    const d = db();
    if (!d.prepare("SELECT 1 AS x FROM conversations WHERE tenant_id=? AND id=?").get(tenantId, conversationId)) return null;
    const id = newId();
    d.prepare("INSERT INTO conversation_notes (id, tenant_id, conversation_id, author_user_id, body, created_at) VALUES (?,?,?,?,?,?)")
      .run(id, tenantId, conversationId, n.authorUserId, n.body.slice(0, 4000), nowIso());
    return mapNote(d.prepare("SELECT * FROM conversation_notes WHERE id=?").get(id) as Row);
  },
  async remove(tenantId, conversationId, noteId, authorUserId) {
    return Number(db().prepare("DELETE FROM conversation_notes WHERE tenant_id=? AND conversation_id=? AND id=? AND author_user_id=?")
      .run(tenantId, conversationId, noteId, authorUserId).changes) === 1;
  },
};

export const events: EventsRepo = {
  async add(tenantId, conversationId, e) {
    const d = db();
    if (!d.prepare("SELECT 1 AS x FROM conversations WHERE tenant_id=? AND id=?").get(tenantId, conversationId)) return;
    d.prepare("INSERT INTO conversation_events (id, tenant_id, conversation_id, actor_user_id, kind, detail, created_at) VALUES (?,?,?,?,?,?,?)")
      .run(newId(), tenantId, conversationId, e.actorUserId, e.kind, JSON.stringify(e.detail ?? {}), nowIso());
  },
  async list(tenantId, conversationId) {
    return (db().prepare("SELECT * FROM conversation_events WHERE tenant_id=? AND conversation_id=? ORDER BY created_at, rowid")
      .all(tenantId, conversationId) as Row[]).map(mapEvent);
  },
  async listSince(tenantId, sinceIso, limit = 20000) {
    return (db().prepare("SELECT * FROM conversation_events WHERE tenant_id=? AND created_at >= ? ORDER BY created_at, rowid LIMIT ?")
      .all(tenantId, sinceIso, Math.max(1, Math.min(limit, 50000))) as Row[]).map(mapEvent);
  },
};
function mapEvent(r: Row): ConversationEvent {
  return {
    id: r.id as string, conversationId: r.conversation_id as string, actorUserId: (r.actor_user_id as string) ?? null,
    kind: r.kind as ConversationEventKind, detail: json(r.detail), createdAt: String(r.created_at ?? ""),
  };
}

export const dashboardPrefs: DashboardPrefsRepo = {
  async get(tenantId, userId) {
    const r = db().prepare("SELECT cards FROM dashboard_prefs WHERE tenant_id=? AND user_id=?").get(tenantId, userId) as Row | undefined;
    return r ? tagsOf(r.cards) : null;
  },
  async save(tenantId, userId, cards) {
    db().prepare(`INSERT INTO dashboard_prefs (tenant_id, user_id, cards, updated_at) VALUES (?,?,?,?)
      ON CONFLICT(tenant_id, user_id) DO UPDATE SET cards=excluded.cards, updated_at=excluded.updated_at`)
      .run(tenantId, userId, JSON.stringify(cards.slice(0, 40)), nowIso());
  },
};
