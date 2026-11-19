// Retention purge, per-customer lookups and the Meta deletion lookups (SQLite). Policy lives in lib/retention.
import type { CustomerConversation, RetentionRepo } from "../types";
import { db, tx, type Row } from "./conn";

// COALESCE everywhere: a NULL here would make "NOT hold" NULL and silently skip the row.
const HOLD_SQL = `(COALESCE(escalation_reason, '') IN ('safety','legal')
  OR COALESCE(CASE WHEN json_valid(state) THEN json_extract(state, '$.legalHold') END, 0) = 1)`;

export const retention: RetentionRepo = {
  async tenantIds() {
    const rows = db().prepare("SELECT id FROM tenants UNION SELECT DISTINCT tenant_id AS id FROM conversations").all() as { id: string }[];
    return rows.map((r) => r.id);
  },
  async purgeTenant(t, c) {
    const d = db();
    return tx(d, () => {
      // 1) Old messages in conversations without legal hold (julianday() copes with both ISO and SQLite datetime formats).
      let messagesDeleted = Number(d.prepare(
        `DELETE FROM messages WHERE tenant_id = ? AND julianday(created_at) < julianday(?)
         AND conversation_id NOT IN (SELECT id FROM conversations WHERE tenant_id = ? AND ${HOLD_SQL})`,
      ).run(t, c.cutoff, t).changes);
      // 2) Conversations idle longer than the window (and their leftover messages).
      const deletedConversationIds = (d.prepare(
        `SELECT id FROM conversations WHERE tenant_id = ? AND julianday(last_message_at) < julianday(?) AND NOT ${HOLD_SQL}`,
      ).all(t, c.cutoff) as { id: string }[]).map((r) => r.id);
      const delMsgs = d.prepare("DELETE FROM messages WHERE tenant_id = ? AND conversation_id = ?");
      const delConv = d.prepare("DELETE FROM conversations WHERE tenant_id = ? AND id = ?");
      let conversationsDeleted = 0;
      for (const id of deletedConversationIds) {
        messagesDeleted += Number(delMsgs.run(t, id).changes);
        conversationsDeleted += Number(delConv.run(t, id).changes);
      }
      // 3) Legal hold: keep the record, mask the text after the hold-mask window.
      const messagesMasked = Number(d.prepare(
        `UPDATE messages SET body = ?, meta = json_set(CASE WHEN json_valid(meta) THEN meta ELSE '{}' END, '$.masked', 1)
         WHERE tenant_id = ? AND body <> ? AND julianday(created_at) < julianday(?)
         AND conversation_id IN (SELECT id FROM conversations WHERE tenant_id = ? AND ${HOLD_SQL})`,
      ).run(c.maskedBody, t, c.maskedBody, c.maskCutoff, t).changes);
      return { messagesDeleted, conversationsDeleted, messagesMasked, deletedConversationIds };
    });
  },
  async findCustomerConversations(tenantId, channel, externalId) {
    return (db().prepare("SELECT * FROM conversations WHERE tenant_id = ? AND channel = ? AND external_id = ?")
      .all(tenantId, channel, externalId) as Row[]).map((r): CustomerConversation => ({
      id: r.id as string, channel: r.channel as string, externalId: r.external_id as string, customerName: r.customer_name as string,
      status: r.status as string, escalationReason: (r.escalation_reason as string) ?? null, state: String(r.state ?? "{}"),
      createdAt: r.created_at as string, lastMessageAt: r.last_message_at as string,
    }));
  },
  async deleteConversations(tenantId, ids) {
    const d = db();
    return tx(d, () => {
      let messages = 0, conversations = 0;
      for (const id of ids) {
        messages += Number(d.prepare("DELETE FROM messages WHERE tenant_id = ? AND conversation_id = ?").run(tenantId, id).changes);
        conversations += Number(d.prepare("DELETE FROM conversations WHERE tenant_id = ? AND id = ?").run(tenantId, id).changes);
      }
      return { conversations, messages };
    });
  },
  async exportMessages(tenantId, conversationId) {
    return (db().prepare("SELECT direction, sender, body, created_at FROM messages WHERE tenant_id = ? AND conversation_id = ? ORDER BY created_at ASC")
      .all(tenantId, conversationId) as { direction: string; sender: string; body: string; created_at: string }[])
      .map((m) => ({ direction: m.direction, sender: m.sender, body: m.body, createdAt: m.created_at }));
  },
  async findMetaDeletionTargets(externalId) {
    return (db().prepare(
      "SELECT DISTINCT tenant_id, channel FROM conversations WHERE external_id = ? AND channel IN ('messenger','instagram')",
    ).all(externalId) as { tenant_id: string; channel: string }[]).map((r) => ({ tenantId: r.tenant_id, channel: r.channel }));
  },
  async metaDeletionReceived(code) {
    return !!db().prepare("SELECT 1 FROM audit_log WHERE action = 'privacy.meta_deletion_request' AND detail LIKE ? LIMIT 1")
      .get(`%"confirmation_code":"${code}"%`);
  },
};
