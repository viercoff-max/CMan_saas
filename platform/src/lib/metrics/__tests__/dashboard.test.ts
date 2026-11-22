import { describe, expect, it } from "vitest";
import type { Conversation, ConversationEvent, Message } from "../../types";
import { computeMetrics, median, periodStart, resolveCards, DEFAULT_ADMIN_CARDS, DEFAULT_AGENT_CARDS } from "../dashboard";

const NOW = new Date("2026-11-22T18:00:00.000Z"); // 12:00 in Mexico City
const SINCE = new Date("2026-11-15T18:00:00.000Z");
const at = (minsAgo: number) => new Date(NOW.getTime() - minsAgo * 60_000).toISOString();
let mid = 0;
const conv = (id: string, o: Partial<Conversation> = {}): Conversation => ({
  id, tenantId: "t", channel: "telegram", externalId: id, customerName: "", status: "bot", escalationReason: null, state: {},
  lastMessageAt: at(0), unread: 0, createdAt: at(60), customerId: `cust-${id}`, assignedTo: null, ...o,
});
const msg = (conversationId: string, sender: Message["sender"], minsAgo: number, meta: Record<string, unknown> = {}, body = "x"): Message => ({
  id: `m${++mid}`, conversationId, tenantId: "t", direction: sender === "customer" ? "in" : "out", sender, body, meta, createdAt: at(minsAgo),
});

describe("computeMetrics", () => {
  const conversations = [conv("a"), conv("b", { status: "human", assignedTo: "u1" }), conv("c"), conv("sim", { channel: "simulator" }), conv("old", { createdAt: at(60 * 24 * 20) })];
  const messages = [
    // a: answered by the bot only
    msg("a", "customer", 300), msg("a", "bot", 299, { intent: "knowledge" }),
    // b: safety handoff, agent answers 12 minutes later, then resolved 60 min after the first message
    msg("b", "customer", 200), msg("b", "bot", 199, { intent: "escalation_safety", escalated: true, escalationReason: "safety" }),
    msg("b", "agent", 187, { agentUserId: "u1" }),
    // c: bot could not answer the question
    msg("c", "customer", 100, {}, "¿hacen envíos a Guatemala?"), msg("c", "bot", 99, { intent: "no_answer", escalated: true, escalationReason: "no_answer" }),
    // simulator never counts; messages before the period never count
    msg("sim", "customer", 50), msg("a", "customer", 60 * 24 * 10),
    // old customer came back
    msg("old", "customer", 30), msg("old", "bot", 29, { intent: "order_status" }),
  ];
  const events: ConversationEvent[] = [{ id: "e1", conversationId: "b", actorUserId: "u1", kind: "status", detail: { from: "human", to: "resolved" }, createdAt: at(140) }];
  const m = computeMetrics({
    now: NOW, since: SINCE, timeZone: "America/Mexico_City", conversations, messages, events,
    returningCustomerIds: new Set(["cust-old"]), isOpen: (d) => d.getUTCHours() >= 15 && d.getUTCHours() < 24,
    waiting: 1, urgent: 1, team: [{ userId: "u1", name: "Paola" }, { userId: "u2", name: "Luis" }],
  });

  it("conversations, bot-resolved share and handoffs (simulator and older messages excluded)", () => {
    expect(m.conversations).toBe(4);
    expect(m.botResolvedPct).toBe(50); // a and old
    expect(m.handoffs).toBe(2);
    expect(m.handoffReasons).toEqual([{ reason: "safety", n: 1 }, { reason: "no_answer", n: 1 }]);
  });
  it("first human response and resolution time are medians in minutes", () => {
    expect(m.firstResponseMin).toBe(12);
    expect(m.firstResponseN).toBe(1);
    expect(m.resolutionMin).toBe(60);
  });
  it("unanswered questions list the customer's question, newest first", () => {
    expect(m.unanswered).toEqual([{ conversationId: "c", text: "¿hacen envíos a Guatemala?", at: at(100) }]);
  });
  it("volume per day / hour, channels, after hours, customers, orders, agents", () => {
    expect(m.perDay).toHaveLength(7);
    expect(m.perDay.reduce((a, r) => a + r.n, 0)).toBe(4);
    expect(m.peakHours.reduce((a, r) => a + r.n, 0)).toBe(4);
    expect(m.channels).toEqual([{ channel: "telegram", n: 4 }]);
    expect(m.inbound).toBe(4);
    expect(m.customers).toEqual({ new: 3, returning: 1 });
    expect(m.orders).toEqual({ found: 1, notFound: 0, other: 0 });
    expect(m.agents[0]).toEqual({ userId: "u1", name: "Paola", replies: 1, assigned: 1 });
    expect(m.waiting).toBe(1);
  });
  it("empty period: no division by zero", () => {
    const e = computeMetrics({ now: NOW, since: SINCE, timeZone: "UTC", conversations: [], messages: [], events: [], waiting: 0, urgent: 0, team: [] });
    expect(e.botResolvedPct).toBeNull();
    expect(e.firstResponseMin).toBeNull();
    expect(e.perDay.every((r) => r.n === 0)).toBe(true);
  });
});

describe("helpers", () => {
  it("median", () => {
    expect(median([])).toBeNull();
    expect(median([5, 1, 3])).toBe(3);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
  it("period start: today = local midnight; 7d / 30d back", () => {
    expect(periodStart("today", NOW, "America/Mexico_City").toISOString()).toBe("2026-11-22T06:00:00.000Z");
    expect(periodStart("7d", NOW, "UTC").toISOString()).toBe(SINCE.toISOString());
    expect(NOW.getTime() - periodStart("30d", NOW, "UTC").getTime()).toBe(30 * 86_400_000);
  });
  it("cards: defaults per role, saved order kept, unknown and admin-only cards dropped for agents", () => {
    expect(resolveCards(null, true)).toEqual(DEFAULT_ADMIN_CARDS);
    expect(resolveCards(null, false)).toEqual(DEFAULT_AGENT_CARDS);
    expect(resolveCards(["ai", "hack", "per_day", "per_day"], true)).toEqual(["ai", "per_day"]);
    expect(resolveCards(["ai", "per_day"], false)).toEqual(["per_day"]);
    expect(resolveCards([], true)).toEqual([]);
  });
});
