// Customers, internal notes and the conversation activity log (Supabase). Every query goes through
// scoped(db, tenantId); ids that are not this tenant's are treated as "not found". Tables come from migration
// 20261122120000_team_inbox.sql (browser roles can only SELECT them; writes happen here, server side).
import type { Channel, ConversationEvent, ConversationEventKind, ConversationNote, Customer } from "../../types";
import { normalizeCustomerPatch } from "../rules";
import type { CustomerListItem, CustomersRepo, DashboardPrefsRepo, EventsRepo, NotesRepo } from "../types";
import { isUuid, scoped, type Db, type Row } from "./client";
import { allRows, cap, escapeLike, isoOr, obj, one, rows, run } from "./map";

const CUSTOMER_COLS = "id, tenant_id, name, email, phone, tags, notes, created_at, updated_at";
const mapCustomer = (r: Row): Customer => ({
  id: r.id as string, tenantId: r.tenant_id as string, name: String(r.name ?? ""), email: (r.email as string) ?? null,
  phone: (r.phone as string) ?? null, tags: Array.isArray(r.tags) ? (r.tags as unknown[]).map(String) : [],
  notes: String(r.notes ?? ""), createdAt: isoOr(r.created_at), updatedAt: isoOr(r.updated_at),
});
const CHUNK = 200;

export function customersRepo(db: Db): CustomersRepo {
  const get = async (tenantId: string, id: string) => {
    if (!isUuid(id)) return null;
    const r = await one(scoped(db, tenantId).from("customers").select(CUSTOMER_COLS).eq("id", id).maybeSingle(), "customers.get");
    return r ? mapCustomer(r) : null;
  };
  return {
    async list(tenantId, q = {}) {
      const s = scoped(db, tenantId);
      const limit = Math.max(1, Math.min(q.limit ?? 200, 1000));
      const base = () => s.from("customers").select(CUSTOMER_COLS).order("updated_at", { ascending: false }).limit(1000);
      let found: Row[];
      if (q.search) {
        const pat = `%${escapeLike(q.search)}%`;
        const parts = await Promise.all(["name", "email", "phone"].map((col) => rows(base().ilike(col, pat), "customers.list")));
        const by = new Map<string, Row>();
        for (const r of parts.flat()) by.set(r.id as string, r);
        found = [...by.values()];
      } else found = await rows(base(), "customers.list");
      const stats = new Map<string, { n: number; last: string | null; channels: Set<Channel> }>();
      const ids = found.map((r) => r.id as string);
      for (let i = 0; i < ids.length; i += CHUNK) {
        const conv = await rows(s.from("conversations").select("customer_id, channel, last_message_at").in("customer_id", ids.slice(i, i + CHUNK)), "customers.list");
        for (const c of conv) {
          const k = c.customer_id as string;
          const st = stats.get(k) ?? { n: 0, last: null, channels: new Set<Channel>() };
          st.n++; st.channels.add(c.channel as Channel);
          const at = isoOr(c.last_message_at);
          if (!st.last || at > st.last) st.last = at;
          stats.set(k, st);
        }
      }
      return found.map((r): CustomerListItem => {
        const st = stats.get(r.id as string);
        return { ...mapCustomer(r), conversations: st?.n ?? 0, lastMessageAt: st?.last ?? null, channels: st ? [...st.channels] : [] };
      }).sort((a, b) => ((b.lastMessageAt ?? b.updatedAt) > (a.lastMessageAt ?? a.updatedAt) ? 1 : -1)).slice(0, limit);
    },
    get,
    async create(tenantId, c) {
      const r = await one(scoped(db, tenantId).from("customers").insert({ name: cap(String(c.name ?? ""), 200) }).select(CUSTOMER_COLS).maybeSingle(), "customers.create");
      return mapCustomer(r!);
    },
    async update(tenantId, id, patch) {
      if (!(await get(tenantId, id))) return null;
      const p = normalizeCustomerPatch(patch);
      const row: Row = { updated_at: new Date().toISOString() };
      for (const k of ["name", "email", "phone", "tags", "notes"] as const) if (p[k] !== undefined) row[k] = p[k];
      await run(scoped(db, tenantId).from("customers").update(row).eq("id", id), "customers.update");
      return get(tenantId, id);
    },
    async merge(tenantId, fromId, intoId) {
      if (fromId === intoId) return false;
      const [from, into] = await Promise.all([get(tenantId, fromId), get(tenantId, intoId)]);
      if (!from || !into) return false;
      const s = scoped(db, tenantId);
      await run(s.from("conversations").update({ customer_id: intoId }).eq("customer_id", fromId), "customers.merge");
      await run(s.from("customers").update({
        tags: [...new Set([...into.tags, ...from.tags])].slice(0, 20),
        notes: [into.notes, from.notes].filter((x) => x.trim()).join("\n\n").slice(0, 4000),
        name: into.name || from.name, email: into.email ?? from.email, phone: into.phone ?? from.phone,
        updated_at: new Date().toISOString(),
      }).eq("id", intoId), "customers.merge");
      await run(s.from("customers").delete().eq("id", fromId), "customers.merge");
      return true;
    },
    async deleteOrphans(tenantId) {
      const s = scoped(db, tenantId);
      const all = (await allRows(() => s.from("customers").select("id").order("id"), "customers.deleteOrphans")).map((r) => r.id as string);
      const used = new Set((await allRows(() => s.from("conversations").select("customer_id").order("id"), "customers.deleteOrphans"))
        .map((r) => r.customer_id as string).filter(Boolean));
      const orphans = all.filter((id) => !used.has(id));
      for (let i = 0; i < orphans.length; i += CHUNK) {
        await run(s.from("customers").delete().in("id", orphans.slice(i, i + CHUNK)), "customers.deleteOrphans");
      }
      return orphans.length;
    },
  };
}

const mapNote = (r: Row): ConversationNote => ({
  id: r.id as string, conversationId: r.conversation_id as string, authorUserId: (r.author_user_id as string) ?? null,
  body: String(r.body ?? ""), createdAt: isoOr(r.created_at),
});

export function notesRepo(db: Db): NotesRepo {
  return {
    async list(tenantId, conversationId) {
      if (!isUuid(conversationId)) return [];
      return (await rows(scoped(db, tenantId).from("conversation_notes").select("id, conversation_id, author_user_id, body, created_at")
        .eq("conversation_id", conversationId).order("created_at").order("id"), "notes.list")).map(mapNote);
    },
    async add(tenantId, conversationId, n) {
      if (!isUuid(conversationId)) return null;
      const s = scoped(db, tenantId);
      if (!(await one(s.from("conversations").select("id").eq("id", conversationId).maybeSingle(), "notes.add"))) return null;
      const r = await one(s.from("conversation_notes").insert({
        conversation_id: conversationId, author_user_id: n.authorUserId && isUuid(n.authorUserId) ? n.authorUserId : null, body: cap(n.body, 4000),
      }).select("id, conversation_id, author_user_id, body, created_at").maybeSingle(), "notes.add");
      return r ? mapNote(r) : null;
    },
    async remove(tenantId, noteId, authorUserId) {
      if (!isUuid(noteId) || !isUuid(authorUserId)) return false;
      const r = await rows(scoped(db, tenantId).from("conversation_notes").delete().eq("id", noteId).eq("author_user_id", authorUserId).select("id"), "notes.remove");
      return r.length === 1;
    },
  };
}

export function eventsRepo(db: Db): EventsRepo {
  return {
    async add(tenantId, conversationId, e) {
      if (!isUuid(conversationId)) return;
      const s = scoped(db, tenantId);
      if (!(await one(s.from("conversations").select("id").eq("id", conversationId).maybeSingle(), "events.add"))) return;
      await run(s.from("conversation_events").insert({
        conversation_id: conversationId, actor_user_id: e.actorUserId && isUuid(e.actorUserId) ? e.actorUserId : null,
        kind: e.kind, detail: e.detail ?? {},
      }), "events.add");
    },
    async list(tenantId, conversationId) {
      if (!isUuid(conversationId)) return [];
      return (await rows(scoped(db, tenantId).from("conversation_events").select("id, conversation_id, actor_user_id, kind, detail, created_at")
        .eq("conversation_id", conversationId).order("created_at").order("id"), "events.list")).map(mapEvent);
    },
    async listSince(tenantId, sinceIso, limit = 20000) {
      const s = scoped(db, tenantId);
      return (await allRows(() => s.from("conversation_events").select("id, conversation_id, actor_user_id, kind, detail, created_at")
        .gte("created_at", sinceIso).order("created_at").order("id"), "events.listSince")).slice(0, Math.max(1, Math.min(limit, 50000))).map(mapEvent);
    },
  };
}
const mapEvent = (r: Row): ConversationEvent => ({
  id: r.id as string, conversationId: r.conversation_id as string, actorUserId: (r.actor_user_id as string) ?? null,
  kind: r.kind as ConversationEventKind, detail: obj(r.detail), createdAt: isoOr(r.created_at),
});

export function dashboardPrefsRepo(db: Db): DashboardPrefsRepo {
  return {
    async get(tenantId, userId) {
      if (!isUuid(userId)) return null;
      const r = await one(scoped(db, tenantId).from("dashboard_prefs").select("cards").eq("user_id", userId).maybeSingle(), "dashboardPrefs.get");
      return r && Array.isArray(r.cards) ? (r.cards as unknown[]).map(String) : null;
    },
    async save(tenantId, userId, cards) {
      if (!isUuid(userId)) return;
      await run(scoped(db, tenantId).from("dashboard_prefs").upsert({ user_id: userId, cards: cards.slice(0, 40), updated_at: new Date().toISOString() }, { onConflict: "tenant_id,user_id" }), "dashboardPrefs.save");
    },
  };
}
