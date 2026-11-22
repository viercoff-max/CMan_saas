// Dashboard metrics. `computeMetrics` is PURE (rows in, numbers out) so every definition is unit tested;
// `loadMetrics` reads one tenant's rows for the period through the data layer (tenant scoped).
// Definitions (period = [since, now)):
//   conversations      real conversations (simulator excluded) with at least one message in the period
//   botResolvedPct     share of those with no agent message and no handoff in the period
//   handoffs           assistant messages that handed the case to a person (meta.escalated), by reason
//   firstResponseMin   median minutes from a handoff to the first agent message after it (same conversation)
//   resolutionMin      median minutes from the conversation's first message in the period to a "resolved" event
//   unanswered         latest customer questions the assistant could not answer (intent no_answer / clarify)
//   intents            assistant replies by kind (knowledge, order status, greeting, ...)
//   perDay / peakHours inbound customer messages per local day / per local hour (business time zone)
//   afterHours         inbound customer messages outside business hours
//   agents             agent replies per team member + conversations assigned to them now
//   customers          new (first conversation in the period) vs returning
//   orders             order status lookups by outcome
import type { Channel, Conversation, ConversationEvent, Message } from "../types";

export const METRIC_KEYS = [
  "waiting", "bot_resolved", "conversations", "handoffs", "first_response", "resolution", "unanswered",
  "per_day", "peak_hours", "channels", "handoff_reasons", "intents", "agents", "customers", "after_hours", "orders", "ai",
] as const;
export type MetricKey = (typeof METRIC_KEYS)[number];
export const isMetricKey = (k: unknown): k is MetricKey => typeof k === "string" && (METRIC_KEYS as readonly string[]).includes(k);

export const DEFAULT_ADMIN_CARDS: MetricKey[] = ["waiting", "bot_resolved", "conversations", "first_response", "unanswered", "per_day", "handoff_reasons", "ai"];
export const DEFAULT_AGENT_CARDS: MetricKey[] = ["waiting", "first_response", "agents", "per_day", "unanswered"];
/** Cards an agent may not see (spend / plan data). */
export const ADMIN_ONLY_CARDS: ReadonlySet<MetricKey> = new Set<MetricKey>(["ai"]);

export type Period = "today" | "7d" | "30d";
export const PERIODS: Period[] = ["today", "7d", "30d"];
export const isPeriod = (p: unknown): p is Period => p === "today" || p === "7d" || p === "30d";

/** Start of the period: local midnight today (business time zone) or N days back. */
export function periodStart(period: Period, now: Date, timeZone: string): Date {
  if (period === "7d") return new Date(now.getTime() - 7 * 86_400_000);
  if (period === "30d") return new Date(now.getTime() - 30 * 86_400_000);
  const { y, m, d, h, mi, s } = localParts(now, timeZone);
  void y; void m; void d;
  return new Date(now.getTime() - ((h * 60 + mi) * 60 + s) * 1000 - now.getMilliseconds());
}

function localParts(at: Date, timeZone: string) {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const p = Object.fromEntries(f.formatToParts(at).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute), s: Number(p.second) };
}
const localDay = (iso: string, tz: string) => { const p = localParts(new Date(iso), tz); return `${p.y}-${String(p.m).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`; };
const localHour = (iso: string, tz: string) => localParts(new Date(iso), tz).h;

export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export interface MetricsInput {
  now: Date; since: Date; timeZone: string;
  conversations: Conversation[];
  messages: Message[];
  events: ConversationEvent[];
  /** Customer ids that already had a conversation before the period (returning customers). */
  returningCustomerIds?: Set<string>;
  isOpen?: (at: Date) => boolean | null;
  waiting: number; urgent: number;
  team: { userId: string; name: string }[];
}

export interface Metrics {
  conversations: number;
  botResolvedPct: number | null;
  handoffs: number;
  handoffReasons: { reason: string; n: number }[];
  firstResponseMin: number | null; firstResponseN: number;
  resolutionMin: number | null; resolutionN: number;
  unanswered: { conversationId: string; text: string; at: string }[];
  intents: { intent: string; n: number }[];
  perDay: { day: string; n: number }[];
  peakHours: { hour: number; n: number }[];
  channels: { channel: Channel; n: number }[];
  afterHours: number; inbound: number;
  agents: { userId: string; name: string; replies: number; assigned: number }[];
  customers: { new: number; returning: number };
  orders: { found: number; notFound: number; other: number };
  waiting: number; urgent: number;
}

const ORDER_FOUND = new Set(["order_status"]);
const ORDER_NOT_FOUND = new Set(["order_not_found"]);
const ORDER_OTHER = new Set(["order_ask_number", "order_ask_email", "order_locked", "order_error", "order_no_connector"]);
const UNANSWERED = new Set(["no_answer", "clarify", "llm_handoff"]);

export function computeMetrics(i: MetricsInput): Metrics {
  const sinceIso = i.since.toISOString();
  const realConv = new Map(i.conversations.filter((c) => c.channel !== "simulator").map((c) => [c.id, c]));
  const msgs = i.messages.filter((m) => m.createdAt >= sinceIso && realConv.has(m.conversationId));
  const byConv = new Map<string, Message[]>();
  for (const m of msgs) { const a = byConv.get(m.conversationId) ?? []; a.push(m); byConv.set(m.conversationId, a); }

  // Conversations and "resolved by the assistant"
  let botOnly = 0;
  for (const [, ms] of byConv) if (!ms.some((m) => m.sender === "agent" || m.meta?.escalated === true)) botOnly++;
  const conversations = byConv.size;

  // Handoffs by reason
  const handoffMsgs = msgs.filter((m) => m.sender === "bot" && m.meta?.escalated === true);
  const reasons = new Map<string, number>();
  for (const m of handoffMsgs) { const r = String(m.meta?.escalationReason ?? "other"); reasons.set(r, (reasons.get(r) ?? 0) + 1); }

  // First human response after a handoff
  const frt: number[] = [];
  for (const [, ms] of byConv) {
    for (let k = 0; k < ms.length; k++) {
      if (!(ms[k].sender === "bot" && ms[k].meta?.escalated === true)) continue;
      const reply = ms.slice(k + 1).find((x) => x.sender === "agent");
      if (reply) frt.push((Date.parse(reply.createdAt) - Date.parse(ms[k].createdAt)) / 60_000);
    }
  }

  // Resolution time: first message in the period -> resolved event
  const res: number[] = [];
  for (const e of i.events) {
    if (e.createdAt < sinceIso || e.kind !== "status" || e.detail?.to !== "resolved") continue;
    const first = byConv.get(e.conversationId)?.[0];
    if (first && first.createdAt <= e.createdAt) res.push((Date.parse(e.createdAt) - Date.parse(first.createdAt)) / 60_000);
  }

  // Unanswered questions: the customer message right before an assistant "no answer" reply
  const unanswered: Metrics["unanswered"] = [];
  for (const [cid, ms] of byConv) {
    ms.forEach((m, k) => {
      if (m.sender !== "bot" || !UNANSWERED.has(String(m.meta?.intent ?? ""))) return;
      const q = [...ms.slice(0, k)].reverse().find((x) => x.sender === "customer" && !x.meta?.media);
      if (q) unanswered.push({ conversationId: cid, text: q.body.slice(0, 160), at: q.createdAt });
    });
  }
  unanswered.sort((a, b) => b.at.localeCompare(a.at));

  // Intents
  const intents = new Map<string, number>();
  for (const m of msgs) if (m.sender === "bot" && m.meta?.intent) { const k = String(m.meta.intent); intents.set(k, (intents.get(k) ?? 0) + 1); }

  // Inbound volume per local day / hour, channels, after hours
  const inboundMsgs = msgs.filter((m) => m.direction === "in");
  const days = new Map<string, number>();
  const dayCount = Math.max(1, Math.round((i.now.getTime() - i.since.getTime()) / 86_400_000));
  for (let d = dayCount - 1; d >= 0; d--) days.set(localDay(new Date(i.now.getTime() - d * 86_400_000).toISOString(), i.timeZone), 0);
  const hours = Array.from({ length: 24 }, () => 0);
  const chans = new Map<Channel, number>();
  let after = 0;
  for (const m of inboundMsgs) {
    const day = localDay(m.createdAt, i.timeZone);
    if (days.has(day)) days.set(day, (days.get(day) ?? 0) + 1);
    hours[localHour(m.createdAt, i.timeZone)]++;
    const ch = realConv.get(m.conversationId)!.channel;
    chans.set(ch, (chans.get(ch) ?? 0) + 1);
    if (i.isOpen && i.isOpen(new Date(m.createdAt)) === false) after++;
  }

  // Agents
  const replies = new Map<string, number>();
  for (const m of msgs) if (m.sender === "agent") { const u = String(m.meta?.agentUserId ?? ""); if (u) replies.set(u, (replies.get(u) ?? 0) + 1); }
  const assigned = new Map<string, number>();
  for (const c of realConv.values()) if (c.assignedTo && c.status !== "resolved" && c.status !== "bot") assigned.set(c.assignedTo, (assigned.get(c.assignedTo) ?? 0) + 1);
  const agents = i.team.map((t) => ({ userId: t.userId, name: t.name, replies: replies.get(t.userId) ?? 0, assigned: assigned.get(t.userId) ?? 0 }))
    .sort((a, b) => b.replies - a.replies || b.assigned - a.assigned);

  // Customers new vs returning (people active in the period)
  const active = new Set<string>();
  for (const cid of byConv.keys()) { const c = realConv.get(cid); if (c?.customerId) active.add(c.customerId); }
  let returning = 0;
  for (const id of active) if (i.returningCustomerIds?.has(id)) returning++;

  // Orders
  const orders = { found: 0, notFound: 0, other: 0 };
  for (const m of msgs) {
    if (m.sender !== "bot") continue;
    const k = String(m.meta?.intent ?? "");
    if (ORDER_FOUND.has(k)) orders.found++; else if (ORDER_NOT_FOUND.has(k)) orders.notFound++; else if (ORDER_OTHER.has(k)) orders.other++;
  }

  const sortDesc = <T extends { n: number }>(a: T[]) => a.sort((x, y) => y.n - x.n);
  return {
    conversations,
    botResolvedPct: conversations ? Math.round((botOnly / conversations) * 100) : null,
    handoffs: handoffMsgs.length,
    handoffReasons: sortDesc([...reasons].map(([reason, n]) => ({ reason, n }))),
    firstResponseMin: median(frt), firstResponseN: frt.length,
    resolutionMin: median(res), resolutionN: res.length,
    unanswered: unanswered.slice(0, 8),
    intents: sortDesc([...intents].map(([intent, n]) => ({ intent, n }))).slice(0, 8),
    perDay: [...days].map(([day, n]) => ({ day, n })),
    peakHours: hours.map((n, hour) => ({ hour, n })),
    channels: sortDesc([...chans].map(([channel, n]) => ({ channel, n }))),
    afterHours: after, inbound: inboundMsgs.length,
    agents,
    customers: { new: active.size - returning, returning },
    orders,
    waiting: i.waiting, urgent: i.urgent,
  };
}

/** The cards a person sees: their saved order (known keys only, admin-only cards dropped for agents) or the default. */
export function resolveCards(saved: string[] | null, isAdmin: boolean): MetricKey[] {
  const base = saved?.filter(isMetricKey) ?? (isAdmin ? DEFAULT_ADMIN_CARDS : DEFAULT_AGENT_CARDS);
  return [...new Set(base)].filter((k) => isAdmin || !ADMIN_ONLY_CARDS.has(k));
}
