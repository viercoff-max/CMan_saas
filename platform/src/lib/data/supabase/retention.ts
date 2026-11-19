// Retention purge, per-customer lookups and Meta deletion lookups (Supabase). Policy lives in lib/retention.
// purgeTenant and deleteConversations run as ONE transaction each inside SQL functions
// (migration 20261120100100_server_rpc_retention). Legal hold = conversations.legal_hold OR escalation_reason in
// (safety, legal) OR state.legalHold, the same rule as SQLite plus the dedicated column.
import type { RetentionRepo } from "../types";
import { isUuid, scoped, type Db } from "./client";
import { deleteConversationsRpc } from "./inbox";
import { allRows, escapeLike, isoOr, mapCustomerConversation, obj, rows, run } from "./map";

export function retentionRepo(db: Db): RetentionRepo {
  return {
    // CROSS-TENANT (retention job): every tenant id.
    async tenantIds() {
      return (await allRows(() => db.from("tenants").select("id").order("id"), "retention.tenantIds")).map((r) => r.id as string);
    },
    async purgeTenant(tenantId, c) {
      const r = obj((await run(scoped(db, tenantId).rpc("retention_purge_tenant", {
        p_cutoff: c.cutoff, p_mask_cutoff: c.maskCutoff, p_masked_body: c.maskedBody,
      }), "retention.purgeTenant")).data);
      return {
        messagesDeleted: Number(r.messagesDeleted ?? 0), conversationsDeleted: Number(r.conversationsDeleted ?? 0),
        messagesMasked: Number(r.messagesMasked ?? 0),
        deletedConversationIds: Array.isArray(r.deletedConversationIds) ? r.deletedConversationIds.map(String) : [],
      };
    },
    async findCustomerConversations(tenantId, channel, externalId) {
      const s = scoped(db, tenantId);
      return (await allRows(() => s.from("conversations")
        .select("id, channel, external_id, customer_name, status, escalation_reason, state, legal_hold, created_at, last_message_at")
        .eq("channel", channel).eq("external_id", externalId).order("id"), "retention.findCustomerConversations")).map(mapCustomerConversation);
    },
    async deleteConversations(tenantId, ids) { return deleteConversationsRpc(scoped(db, tenantId), ids, "retention.deleteConversations"); },
    async exportMessages(tenantId, conversationId) {
      if (!isUuid(conversationId)) return [];
      const s = scoped(db, tenantId);
      return (await allRows(() => s.from("messages").select("direction, sender, body, created_at").eq("conversation_id", conversationId).order("created_at").order("id"), "retention.exportMessages"))
        .map((m) => ({ direction: String(m.direction ?? ""), sender: String(m.sender ?? ""), body: String(m.body ?? ""), createdAt: isoOr(m.created_at) }));
    },
    // CROSS-TENANT (Meta data-deletion callback).
    async findMetaDeletionTargets(externalId) {
      const rs = await allRows(() => db.from("conversations").select("tenant_id, channel").eq("external_id", externalId).in("channel", ["messenger", "instagram"]).order("id"), "retention.findMetaDeletionTargets");
      const seen = new Map<string, { tenantId: string; channel: string }>();
      for (const r of rs) seen.set(`${r.tenant_id}|${r.channel}`, { tenantId: r.tenant_id as string, channel: r.channel as string });
      return [...seen.values()];
    },
    // CROSS-TENANT: was a Meta deletion request with this confirmation code audited?
    async metaDeletionReceived(code) {
      const rs = await rows(db.from("audit_log").select("id").eq("action", "privacy.meta_deletion_request")
        .like("detail", `%"confirmation_code":"${escapeLike(code)}"%`).limit(1), "retention.metaDeletionReceived");
      return rs.length > 0;
    },
  };
}
