// Conversations and messages (Supabase).
//   * provider_message_id is a real column with the unique index uq_msg_provider: a 23505 there means the same
//     inbound message was delivered twice, so `add` returns the stored message instead of failing.
//   * last_message_at / unread are bumped by the conversation_touch RPC (atomic unread + 1; PostgREST cannot do it).
//   * Deleting a conversation goes through retention_delete_conversations (one transaction).
import { nowIso } from "../../ids";
import { CONVERSATION_STATUSES, emptyStatusCounts, type ConversationStatus } from "../../types";
import { isLegalHoldReason } from "../rules";
import type { ConversationsRepo, MessagesRepo } from "../types";
import { isUuid, scoped, type Db, type Row, type Scoped } from "./client";
import {
  UQ_MSG_PROVIDER, allRows, cap, count, escapeLike, isUniqueViolation, mapConversation, mapDbError, mapMessage, obj, one, rows, run,
} from "./map";

const CONV_COLS = "id, tenant_id, channel, external_id, customer_name, status, escalation_reason, state, last_message_at, unread, legal_hold, assigned_to, customer_id, created_at";
const MSG_COLS = "id, conversation_id, tenant_id, direction, sender, body, meta, provider_message_id, created_at";
const STATUSES: ConversationStatus[] = CONVERSATION_STATUSES;

async function getConv(s: Scoped, id: string) {
  if (!isUuid(id)) return null;
  const r = await one(s.from("conversations").select(CONV_COLS).eq("id", id).maybeSingle(), "conversations.get");
  return r ? mapConversation(r) : null;
}

export async function deleteConversationsRpc(s: Scoped, ids: string[], ctx: string): Promise<{ conversations: number; messages: number }> {
  const valid = [...new Set(ids.filter(isUuid))];
  if (!valid.length) return { conversations: 0, messages: 0 };
  const r = obj((await run(s.rpc("retention_delete_conversations", { p_ids: valid }), ctx)).data);
  return { conversations: Number(r.conversations ?? 0), messages: Number(r.messages ?? 0) };
}

/** A real (non-simulator) conversation without a customer record gets one, named after the conversation. */
async function ensureCustomer(s: Scoped, r: Row): Promise<Row> {
  if (r.channel === "simulator" || r.customer_id) return r;
  const c = await one(s.from("customers").insert({ name: cap(String(r.customer_name ?? ""), 200) }).select("id").maybeSingle(), "conversations.ensureCustomer");
  if (!c) return r;
  await run(s.from("conversations").update({ customer_id: c.id }).eq("id", r.id).is("customer_id", null), "conversations.ensureCustomer");
  return { ...r, customer_id: c.id };
}

export function conversationsRepo(db: Db): ConversationsRepo {
  return {
    async getOrCreate(tenantId, channel, externalId, customerName = "") {
      const s = scoped(db, tenantId);
      const find = () => one(s.from("conversations").select(CONV_COLS).eq("channel", channel).eq("external_id", externalId).maybeSingle(), "conversations.getOrCreate");
      let r = await find();
      if (r) {
        if (customerName && !r.customer_name) {
          await run(s.from("conversations").update({ customer_name: cap(customerName, 200) }).eq("id", r.id), "conversations.getOrCreate");
          r = { ...r, customer_name: cap(customerName, 200) };
        }
        return mapConversation(await ensureCustomer(s, r));
      }
      const ins = await s.from("conversations").insert({ channel, external_id: externalId, customer_name: cap(customerName, 200) }).select(CONV_COLS).maybeSingle();
      if (ins.error) {
        // Lost a race against a concurrent insert of the same (tenant, channel, external_id): read the winner.
        if (isUniqueViolation(ins.error)) { r = await find(); if (r) return mapConversation(r); }
        throw mapDbError(ins.error, "conversations.getOrCreate");
      }
      return mapConversation(await ensureCustomer(s, ins.data as Row));
    },
    async get(tenantId, id) { return getConv(scoped(db, tenantId), id); },
    async list(tenantId, f = {}) {
      const s = scoped(db, tenantId);
      const limit = Math.max(0, Math.min(f.limit ?? 200, 1000));
      const base = () => {
        let q = s.from("conversations").select(CONV_COLS);
        if (f.channel) q = q.eq("channel", f.channel);
        if (f.status) q = q.eq("status", f.status);
        if (f.assignedTo === "none") q = q.is("assigned_to", null);
        else if (f.assignedTo) q = isUuid(f.assignedTo) ? q.eq("assigned_to", f.assignedTo) : q.eq("id", "00000000-0000-0000-0000-000000000000");
        if (f.customerId) q = isUuid(f.customerId) ? q.eq("customer_id", f.customerId) : q.eq("id", "00000000-0000-0000-0000-000000000000");
        return q;
      };
      const ordered = (q: ReturnType<typeof base>) => q.order("last_message_at", { ascending: false }).order("id").limit(limit);
      if (!f.search) return (await rows(ordered(base()), "conversations.list")).map(mapConversation);
      // customer_name OR external_id: two literal ILIKE queries merged (no user text inside an `or=` filter string).
      const pat = `%${escapeLike(f.search)}%`;
      const [a, b] = await Promise.all([
        rows(ordered(base().ilike("customer_name", pat)), "conversations.list"),
        rows(ordered(base().ilike("external_id", pat)), "conversations.list"),
      ]);
      const by = new Map<string, Row>();
      for (const r of [...a, ...b]) by.set(r.id as string, r);
      return [...by.values()].map(mapConversation)
        .sort((x, y) => (x.lastMessageAt < y.lastMessageAt ? 1 : x.lastMessageAt > y.lastMessageAt ? -1 : x.id < y.id ? -1 : 1))
        .slice(0, limit);
    },
    async setStatus(tenantId, id, status, reason) {
      if (!isUuid(id)) return;
      const patch: Row = { status };
      if (reason !== null && reason !== undefined) patch.escalation_reason = cap(reason, 40);
      // H1: sticky legal hold. Only ever set to true here (the DB trigger from migration 20261120013722 does the same
      // and refuses to clear it); no app code path writes legal_hold = false.
      if (isLegalHoldReason(reason)) patch.legal_hold = true;
      await run(scoped(db, tenantId).from("conversations").update(patch).eq("id", id), "conversations.setStatus");
    },
    async setState(tenantId, id, state) {
      if (!isUuid(id)) return;
      await run(scoped(db, tenantId).from("conversations").update({ state }).eq("id", id), "conversations.setState");
    },
    async markRead(tenantId, id) {
      if (!isUuid(id)) return;
      await run(scoped(db, tenantId).from("conversations").update({ unread: 0 }).eq("id", id), "conversations.markRead");
    },
    async countByStatus(tenantId) {
      const s = scoped(db, tenantId);
      const counts = await Promise.all(STATUSES.map((st) =>
        count(s.from("conversations").select("id", { count: "exact", head: true }).eq("status", st).neq("channel", "simulator"), "conversations.countByStatus")));
      const out: Record<ConversationStatus, number> = emptyStatusCounts();
      STATUSES.forEach((st, i) => { out[st] = counts[i]; });
      return out;
    },
    // escalation_reason is display-only; legal_hold is never part of this patch (H1).
    async resetForBot(tenantId, id) {
      const s = scoped(db, tenantId);
      const c = await getConv(s, id);
      if (!c) return;
      const state = { ...c.state };
      delete state.offer;
      state.misses = 0;
      state.botTurns = 0;
      state.capOffered = false;
      await run(s.from("conversations").update({ escalation_reason: null, state }).eq("id", id), "conversations.resetForBot");
    },
    async delete(tenantId, id) { return deleteConversationsRpc(scoped(db, tenantId), [id], "conversations.delete"); },
    async findIdByExternal(tenantId, channel, externalId) {
      const r = await one(scoped(db, tenantId).from("conversations").select("id").eq("channel", channel).eq("external_id", externalId).maybeSingle(), "conversations.findIdByExternal");
      return (r?.id as string) ?? null;
    },
    async listIdsByExternalPrefix(tenantId, prefix) {
      const s = scoped(db, tenantId);
      return (await allRows(() => s.from("conversations").select("id").like("external_id", `${escapeLike(prefix)}%`).order("id"), "conversations.listIdsByExternalPrefix"))
        .map((r) => r.id as string);
    },
    async assign(tenantId, id, userId) {
      if (!isUuid(id) || (userId !== null && !isUuid(userId))) return false;
      const r = await rows(scoped(db, tenantId).from("conversations").update({ assigned_to: userId }).eq("id", id).select("id"), "conversations.assign");
      return r.length === 1;
    },
    async setCustomer(tenantId, id, customerId) {
      if (!isUuid(id) || (customerId !== null && !isUuid(customerId))) return false;
      const s = scoped(db, tenantId);
      if (customerId && !(await one(s.from("customers").select("id").eq("id", customerId).maybeSingle(), "conversations.setCustomer"))) return false;
      const r = await rows(s.from("conversations").update({ customer_id: customerId }).eq("id", id).select("id"), "conversations.setCustomer");
      return r.length === 1;
    },
    async setTimestamps(tenantId, id, v) {
      if (!isUuid(id)) return;
      const patch: Row = {};
      if (v.unread !== undefined) patch.unread = v.unread;
      if (v.createdAt !== undefined) patch.created_at = v.createdAt;
      if (v.lastMessageAt !== undefined) patch.last_message_at = v.lastMessageAt;
      if (!Object.keys(patch).length) return;
      await run(scoped(db, tenantId).from("conversations").update(patch).eq("id", id), "conversations.setTimestamps");
    },
  };
}

export function messagesRepo(db: Db): MessagesRepo {
  return {
    async add(tenantId, conversationId, m) {
      const s = scoped(db, tenantId);
      if (!isUuid(conversationId)) throw mapDbError({ code: "23503" }, "messages.add");
      const pmid = m.providerMessageId ? cap(m.providerMessageId, 200) : null;
      const meta = pmid ? { ...(m.meta ?? {}), providerMessageId: pmid } : (m.meta ?? {});
      // created_at comes from the database clock (now(), microseconds) so messages keep their insertion order.
      const ins = await s.from("messages").insert({
        conversation_id: conversationId, direction: m.direction, sender: m.sender, body: cap(m.body, 8000),
        meta, provider_message_id: pmid,
      }).select(MSG_COLS).maybeSingle();
      if (ins.error) {
        if (pmid && isUniqueViolation(ins.error, UQ_MSG_PROVIDER)) {
          // Duplicate inbound delivery: keep the first copy, do not bump unread again.
          const dup = await one(s.from("messages").select(MSG_COLS).eq("conversation_id", conversationId).eq("provider_message_id", pmid).maybeSingle(), "messages.add");
          if (dup) return mapMessage(dup);
        }
        throw mapDbError(ins.error, "messages.add");
      }
      const stored = ins.data as Row;
      await run(s.rpc("conversation_touch", { p_conversation: conversationId, p_at: stored.created_at ?? nowIso(), p_inbound: m.direction === "in" }), "messages.add");
      return mapMessage(stored);
    },
    async list(tenantId, conversationId, limit = 500) {
      if (!isUuid(conversationId)) return [];
      const s = scoped(db, tenantId);
      const make = () => s.from("messages").select(MSG_COLS).eq("conversation_id", conversationId).order("created_at").order("id");
      const out = limit <= 1000 ? await rows(make().limit(limit), "messages.list") : (await allRows(make, "messages.list")).slice(0, limit);
      return out.map(mapMessage);
    },
    async recent(tenantId, conversationId, n) {
      if (!isUuid(conversationId) || n <= 0) return [];
      const rs = await rows(scoped(db, tenantId).from("messages").select("sender, body, meta, created_at").eq("conversation_id", conversationId)
        .order("created_at", { ascending: false }).limit(n), "messages.recent");
      return rs.reverse().map((r) => {
        const intent = obj(r.meta).intent;
        return { sender: String(r.sender ?? ""), body: String(r.body ?? ""), intent: typeof intent === "string" ? intent : null };
      });
    },
    async latest(tenantId, conversationIds) {
      const s = scoped(db, tenantId);
      const out = new Map<string, { body: string; sender: string }>();
      const ids = [...new Set(conversationIds.filter(isUuid))];
      const found = await Promise.all(ids.map((id) =>
        rows(s.from("messages").select("body, sender").eq("conversation_id", id).order("created_at", { ascending: false }).limit(1), "messages.latest")));
      ids.forEach((id, i) => { const r = found[i][0]; if (r) out.set(id, { body: String(r.body ?? ""), sender: String(r.sender ?? "") }); });
      return out;
    },
    async lastInboundAt(tenantId, conversationId) {
      if (!isUuid(conversationId)) return null;
      const rs = await rows(scoped(db, tenantId).from("messages").select("created_at").eq("conversation_id", conversationId).eq("direction", "in")
        .order("created_at", { ascending: false }).limit(1), "messages.lastInboundAt");
      return rs[0] ? mapMessage({ created_at: rs[0].created_at }).createdAt : null;
    },
    async hasProviderMessage(tenantId, conversationId, providerMessageId) {
      if (!isUuid(conversationId)) return false;
      const rs = await rows(scoped(db, tenantId).from("messages").select("id").eq("conversation_id", conversationId).eq("direction", "in")
        .eq("provider_message_id", providerMessageId).limit(1), "messages.hasProviderMessage");
      return rs.length > 0;
    },
    async listSince(tenantId, sinceIso, limit = 20000) {
      const s = scoped(db, tenantId);
      const cap = Math.max(1, Math.min(limit, 50000));
      return (await allRows(() => s.from("messages").select(MSG_COLS).gte("created_at", sinceIso).order("created_at").order("id"), "messages.listSince"))
        .slice(0, cap).map(mapMessage);
    },
    async setCreatedAt(tenantId, messageId, at) {
      if (!isUuid(messageId)) return;
      await run(scoped(db, tenantId).from("messages").update({ created_at: at }).eq("id", messageId), "messages.setCreatedAt");
    },
  };
}
