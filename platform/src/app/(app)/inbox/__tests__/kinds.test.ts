import { describe, expect, it } from "vitest";
import { ESCALATION_REASONS, inboxRank, isDemoConversation, isKnownReason, isUrgent, sortForInbox, summarize } from "../kinds";
import { inboxDict } from "../dict";
import type { Conversation } from "@/lib/types";

const conv = (o: Partial<Conversation>): Conversation => ({
  id: "c", tenantId: "t", channel: "telegram", externalId: "123", customerName: "", status: "bot", escalationReason: null,
  state: {}, lastMessageAt: "2026-11-01T00:00:00Z", unread: 0, createdAt: "2026-11-01T00:00:00Z", ...o,
});

describe("inbox kinds", () => {
  it("demo conversations are recognised by the seed markers only", () => {
    expect(isDemoConversation(conv({ externalId: "demo-andrea" }))).toBe(true);
    expect(isDemoConversation(conv({ state: { demo: true } }))).toBe(true);
    expect(isDemoConversation(conv({ externalId: "5215512345678" }))).toBe(false);
    expect(isDemoConversation(conv({ externalId: "sim-demo" }))).toBe(false);
  });

  it("urgent = waiting for a person because of safety or legal", () => {
    expect(isUrgent(conv({ status: "needs_human", escalationReason: "safety" }))).toBe(true);
    expect(isUrgent(conv({ status: "needs_human", escalationReason: "legal" }))).toBe(true);
    expect(isUrgent(conv({ status: "needs_human", escalationReason: "human_request" }))).toBe(false);
    expect(isUrgent(conv({ status: "human", escalationReason: "safety" }))).toBe(false); // already taken
  });

  it("sorts urgent first, then waiting, then the rest (newest first inside each)", () => {
    const rows = [
      conv({ id: "bot-new", status: "bot", lastMessageAt: "2026-11-05T00:00:00Z" }),
      conv({ id: "wait-old", status: "needs_human", escalationReason: "human_request", lastMessageAt: "2026-11-01T00:00:00Z" }),
      conv({ id: "urgent-old", status: "needs_human", escalationReason: "safety", lastMessageAt: "2026-10-01T00:00:00Z" }),
      conv({ id: "wait-new", status: "needs_human", escalationReason: "no_answer", lastMessageAt: "2026-11-04T00:00:00Z" }),
    ];
    expect(sortForInbox(rows).map((c) => c.id)).toEqual(["urgent-old", "wait-new", "wait-old", "bot-new"]);
    expect([inboxRank(rows[2]), inboxRank(rows[1]), inboxRank(rows[0])]).toEqual([0, 1, 2]);
  });

  it("summarize excludes the simulator and counts urgent apart", () => {
    const s = summarize([
      conv({ status: "needs_human", escalationReason: "safety" }),
      conv({ status: "needs_human", escalationReason: "human_request" }),
      conv({ status: "human" }),
      conv({ channel: "simulator", status: "needs_human", escalationReason: "safety" }),
    ]);
    expect(s).toEqual({ counts: { bot: 0, needs_human: 2, human: 1, pending: 0, waiting_customer: 0, resolved: 0 }, urgent: 1 });
  });

  it("every escalation reason (incl. ai_cap_reached) has a label in both languages", () => {
    for (const r of ESCALATION_REASONS) {
      expect(inboxDict.es[`r.${r}`], r).toBeTruthy();
      expect(inboxDict.en[`r.${r}`], r).toBeTruthy();
    }
    expect(inboxDict.es["r.ai_cap_reached"]).toBe("Se alcanzó el límite de IA del mes");
    expect(isKnownReason("ai_cap_reached")).toBe(true);
    expect(isKnownReason("made_up")).toBe(false);
    expect(inboxDict.es["demo.note"]).toBe("Esta conversación es de demostración: la respuesta se guarda pero no se envía a ningún canal.");
  });
});
