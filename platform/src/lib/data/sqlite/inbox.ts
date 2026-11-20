// Conversations and messages (SQLite). provider_message_id is stored in messages.meta.providerMessageId
// (indexed by idx_msg_provider); the Supabase schema has a dedicated column with a unique index.
import { newId, nowIso } from "../../ids";
import type { Channel, Conversation, ConversationStatus, Message, Sender } from "../../types";
import { isLegalHoldReason } from "../rules";
import type { ConversationsRepo, MessagesRepo } from "../types";
import { db, json, tx, type Row } from "./conn";

const mapConv = (r: Row): Conversation => ({
  id: r.id as string, tenantId: r.tenant_id as string, channel: r.channel as Channel, externalId: r.external_id as string,
  customerName: r.customer_name as string, status: r.status as ConversationStatus,
  escalationReason: (r.escalation_reason as string) ?? null, state: json(r.state),
  lastMessageAt: r.last_message_at as string, unread: r.unread as number, createdAt: r.created_at as string,
  legalHold: Number(r.legal_hold ?? 0) === 1,
});
const mapMsg = (r: Row): Message => {
  const meta = json(r.meta);
  return {
    id: r.id as string, conversationId: r.conversation_id as string, tenantId: r.tenant_id as string,
    direction: r.direction as "in" | "out", sender: r.sender as Sender, body: r.body as string,
    meta, providerMessageId: typeof meta.providerMessageId === "string" ? meta.providerMessageId : null, createdAt: r.created_at as string,
  };
};

const getConv = (tenantId: string, id: string): Conversation | null => {
  const r = db().prepare("SELECT * FROM conversations WHERE tenant_id=? AND id=?").get(tenantId, id) as Row | undefined;
  return r ? mapConv(r) : null;
};
function deleteConv(tenantId: string, id: string): { conversations: number; messages: number } {
  const d = db();
  const messages = Number(d.prepare("DELETE FROM messages WHERE tenant_id=? AND conversation_id=?").run(tenantId, id).changes);
  const conversations = Number(d.prepare("DELETE FROM conversations WHERE tenant_id=? AND id=?").run(tenantId, id).changes);
  return { conversations, messages };
}

export const conversations: ConversationsRepo = {
  async getOrCreate(tenantId, channel, externalId, customerName = "") {
    const d = db();
    const r = d.prepare("SELECT * FROM conversations WHERE tenant_id=? AND channel=? AND external_id=?").get(tenantId, channel, externalId) as Row | undefined;
    if (r) {
      if (customerName && !r.customer_name) d.prepare("UPDATE conversations SET customer_name=? WHERE tenant_id=? AND id=?").run(customerName, tenantId, r.id as string);
      return getConv(tenantId, r.id as string)!;
    }
    const id = newId();
    d.prepare("INSERT INTO conversations (id, tenant_id, channel, external_id, customer_name) VALUES (?,?,?,?,?)")
      .run(id, tenantId, channel, externalId, customerName);
    return getConv(tenantId, id)!;
  },
  async get(tenantId, id) { return getConv(tenantId, id); },
  async list(tenantId, f = {}) {
    const where = ["tenant_id = ?"]; const args: (string | number)[] = [tenantId];
    if (f.channel) { where.push("channel = ?"); args.push(f.channel); }
    if (f.status) { where.push("status = ?"); args.push(f.status); }
    if (f.search) { where.push("(customer_name LIKE ? OR external_id LIKE ?)"); args.push(`%${f.search}%`, `%${f.search}%`); }
    args.push(f.limit ?? 200);
    return (db().prepare(`SELECT * FROM conversations WHERE ${where.join(" AND ")} ORDER BY last_message_at DESC LIMIT ?`).all(...args) as Row[]).map(mapConv);
  },
  // H1: a safety/legal escalation sets the sticky legal_hold; nothing here (or anywhere in app code) clears it.
  async setStatus(tenantId, id, status, reason) {
    db().prepare(`UPDATE conversations SET status=?, escalation_reason=COALESCE(?, escalation_reason),
        legal_hold = CASE WHEN ? = 1 THEN 1 ELSE legal_hold END WHERE tenant_id=? AND id=?`)
      .run(status, reason ?? null, isLegalHoldReason(reason) ? 1 : 0, tenantId, id);
  },
  async setState(tenantId, id, state) {
    db().prepare("UPDATE conversations SET state=? WHERE tenant_id=? AND id=?").run(JSON.stringify(state), tenantId, id);
  },
  async markRead(tenantId, id) {
    db().prepare("UPDATE conversations SET unread=0 WHERE tenant_id=? AND id=?").run(tenantId, id);
  },
  async countByStatus(tenantId) {
    const out: Record<ConversationStatus, number> = { bot: 0, needs_human: 0, human: 0, resolved: 0 };
    for (const r of db().prepare("SELECT status, COUNT(*) c FROM conversations WHERE tenant_id=? AND channel <> 'simulator' GROUP BY status").all(tenantId) as Row[])
      out[r.status as ConversationStatus] = r.c as number;
    return out;
  },
  // escalation_reason is display-only; the legal_hold column is kept (H1).
  async resetForBot(tenantId, id) {
    const d = db();
    d.prepare("UPDATE conversations SET escalation_reason=NULL WHERE tenant_id=? AND id=?").run(tenantId, id);
    const r = d.prepare("SELECT state FROM conversations WHERE tenant_id=? AND id=?").get(tenantId, id) as Row | undefined;
    if (!r) return;
    const state = json(r.state);
    delete state.offer;
    state.misses = 0;
    state.botTurns = 0;
    state.capOffered = false;
    d.prepare("UPDATE conversations SET state=? WHERE tenant_id=? AND id=?").run(JSON.stringify(state), tenantId, id);
  },
  async delete(tenantId, id) { return tx(db(), () => deleteConv(tenantId, id)); },
  async findIdByExternal(tenantId, channel, externalId) {
    const r = db().prepare("SELECT id FROM conversations WHERE tenant_id=? AND channel=? AND external_id=?").get(tenantId, channel, externalId) as Row | undefined;
    return (r?.id as string) ?? null;
  },
  async listIdsByExternalPrefix(tenantId, prefix) {
    return (db().prepare("SELECT id FROM conversations WHERE tenant_id=? AND substr(external_id,1,?)=?").all(tenantId, prefix.length, prefix) as Row[]).map((r) => r.id as string);
  },
  async setTimestamps(tenantId, id, v) {
    const sets: string[] = []; const args: (string | number)[] = [];
    if (v.unread !== undefined) { sets.push("unread=?"); args.push(v.unread); }
    if (v.createdAt !== undefined) { sets.push("created_at=?"); args.push(v.createdAt); }
    if (v.lastMessageAt !== undefined) { sets.push("last_message_at=?"); args.push(v.lastMessageAt); }
    if (!sets.length) return;
    db().prepare(`UPDATE conversations SET ${sets.join(", ")} WHERE tenant_id=? AND id=?`).run(...args, tenantId, id);
  },
};

export const messages: MessagesRepo = {
  async add(tenantId, conversationId, m) {
    const d = db(); const id = newId(); const at = nowIso();
    const meta = m.providerMessageId ? { ...(m.meta ?? {}), providerMessageId: m.providerMessageId } : (m.meta ?? {});
    d.prepare("INSERT INTO messages (id, conversation_id, tenant_id, direction, sender, body, meta, created_at) VALUES (?,?,?,?,?,?,?,?)")
      .run(id, conversationId, tenantId, m.direction, m.sender, m.body, JSON.stringify(meta), at);
    d.prepare("UPDATE conversations SET last_message_at=?, unread = unread + ? WHERE tenant_id=? AND id=?")
      .run(at, m.direction === "in" ? 1 : 0, tenantId, conversationId);
    return mapMsg(d.prepare("SELECT * FROM messages WHERE tenant_id=? AND id=?").get(tenantId, id) as Row);
  },
  async list(tenantId, conversationId, limit = 500) {
    return (db().prepare("SELECT * FROM messages WHERE tenant_id=? AND conversation_id=? ORDER BY created_at ASC LIMIT ?")
      .all(tenantId, conversationId, limit) as Row[]).map(mapMsg);
  },
  // rowid breaks ties between messages stored in the same millisecond.
  async recent(tenantId, conversationId, n) {
    const rows = db().prepare(
      "SELECT sender, body, json_extract(meta, '$.intent') AS intent FROM messages WHERE tenant_id=? AND conversation_id=? ORDER BY created_at DESC, rowid DESC LIMIT ?",
    ).all(tenantId, conversationId, n) as { sender: string; body: string; intent: string | null }[];
    return rows.reverse().map((r) => ({ sender: r.sender, body: r.body, intent: r.intent ?? null }));
  },
  async latest(tenantId, conversationIds) {
    const stmt = db().prepare("SELECT body, sender FROM messages WHERE tenant_id=? AND conversation_id=? ORDER BY created_at DESC LIMIT 1");
    const out = new Map<string, { body: string; sender: string }>();
    for (const id of conversationIds) {
      const r = stmt.get(tenantId, id) as Row | undefined;
      if (r) out.set(id, { body: String(r.body ?? ""), sender: String(r.sender ?? "") });
    }
    return out;
  },
  async lastInboundAt(tenantId, conversationId) {
    const r = db().prepare("SELECT created_at FROM messages WHERE tenant_id=? AND conversation_id=? AND direction='in' ORDER BY created_at DESC LIMIT 1")
      .get(tenantId, conversationId) as Row | undefined;
    return (r?.created_at as string) ?? null;
  },
  async hasProviderMessage(tenantId, conversationId, providerMessageId) {
    return !!db().prepare(
      "SELECT 1 AS x FROM messages WHERE tenant_id=? AND conversation_id=? AND direction='in' AND json_extract(meta, '$.providerMessageId') = ? LIMIT 1",
    ).get(tenantId, conversationId, providerMessageId);
  },
  async setCreatedAt(tenantId, messageId, at) {
    db().prepare("UPDATE messages SET created_at=? WHERE tenant_id=? AND id=?").run(at, tenantId, messageId);
  },
};
