// Inbox-specific queries (tenant scoped). Extends store.ts without editing it.
import { getDb } from "../db";
import type { Channel, Conversation } from "../types";

type Row = Record<string, unknown>;
export interface ConversationListItem extends Conversation { preview: string; previewSender: string }

export function withPreviews(tenantId: string, convs: Conversation[]): ConversationListItem[] {
  const stmt = getDb().prepare("SELECT body, sender FROM messages WHERE tenant_id=? AND conversation_id=? ORDER BY created_at DESC LIMIT 1");
  return convs.map((c) => {
    const r = stmt.get(tenantId, c.id) as Row | undefined;
    return { ...c, preview: String(r?.body ?? "").slice(0, 120), previewSender: String(r?.sender ?? "") };
  });
}

export function lastInboundAt(tenantId: string, conversationId: string): string | null {
  const r = getDb().prepare("SELECT created_at FROM messages WHERE tenant_id=? AND conversation_id=? AND direction='in' ORDER BY created_at DESC LIMIT 1")
    .get(tenantId, conversationId) as Row | undefined;
  return (r?.created_at as string) ?? null;
}

const WINDOW_MS = 24 * 60 * 60 * 1000;
export function isWindowExpired(channel: Channel, lastInbound: string | null, now = Date.now()): boolean {
  if (channel === "simulator") return false;
  if (!lastInbound) return true;
  return now - new Date(lastInbound).getTime() > WINDOW_MS;
}

export function deleteSimulatorConversation(tenantId: string, externalId: string): void {
  const db = getDb();
  const r = db.prepare("SELECT id FROM conversations WHERE tenant_id=? AND channel='simulator' AND external_id=?").get(tenantId, externalId) as Row | undefined;
  if (!r) return;
  db.prepare("DELETE FROM messages WHERE tenant_id=? AND conversation_id=?").run(tenantId, r.id as string);
  db.prepare("DELETE FROM conversations WHERE tenant_id=? AND id=?").run(tenantId, r.id as string);
}

/** Disconnect must really wipe the stored secrets (store.saveChannelAccount keeps them). */
export function clearChannelSecrets(tenantId: string, channel: string): void {
  getDb().prepare("UPDATE channel_accounts SET config_enc=NULL WHERE tenant_id=? AND channel=?").run(tenantId, channel);
}

/**
 * "Return to bot" / "resolve": store.setConversationStatus keeps the old escalation_reason (COALESCE), so clear it here,
 * and reset the engine's per-episode counters (misses, pending human offer, bot-turn cap) so the bot starts fresh.
 * The order lock (state.order.locked) is kept on purpose: it protects against email guessing.
 */
export function resetConversationForBot(tenantId: string, conversationId: string): void {
  const db = getDb();
  db.prepare("UPDATE conversations SET escalation_reason=NULL WHERE tenant_id=? AND id=?").run(tenantId, conversationId);
  const r = db.prepare("SELECT state FROM conversations WHERE tenant_id=? AND id=?").get(tenantId, conversationId) as Row | undefined;
  if (!r) return;
  let state: Record<string, unknown> = {};
  try { const p = JSON.parse(String(r.state ?? "{}")); if (p && typeof p === "object" && !Array.isArray(p)) state = p; } catch { /* keep {} */ }
  delete state.offer;
  state.misses = 0;
  state.botTurns = 0;
  state.capOffered = false;
  db.prepare("UPDATE conversations SET state=? WHERE tenant_id=? AND id=?").run(JSON.stringify(state), tenantId, conversationId);
}
