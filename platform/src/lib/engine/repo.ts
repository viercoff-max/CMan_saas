// Engine-owned queries (store.ts is shared and must not be edited). Always scoped by tenant_id.
import { getDb } from "../db";

/** True if an inbound message with this provider id was already stored for the tenant/conversation. */
export function hasProviderMessage(tenantId: string, conversationId: string, providerMessageId: string): boolean {
  const r = getDb().prepare(
    "SELECT 1 AS x FROM messages WHERE tenant_id=? AND conversation_id=? AND direction='in' AND json_extract(meta, '$.providerMessageId') = ? LIMIT 1",
  ).get(tenantId, conversationId, providerMessageId);
  return !!r;
}

/** Last `n` messages (oldest first). rowid breaks ties between messages stored in the same millisecond. */
export function recentMessages(tenantId: string, conversationId: string, n: number): { sender: string; body: string; intent: string | null }[] {
  const rows = getDb().prepare(
    "SELECT sender, body, json_extract(meta, '$.intent') AS intent FROM messages WHERE tenant_id=? AND conversation_id=? ORDER BY created_at DESC, rowid DESC LIMIT ?",
  ).all(tenantId, conversationId, n) as { sender: string; body: string; intent: string | null }[];
  return rows.reverse();
}
