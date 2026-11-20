// "Plan y uso" math: the AI usage meter (cap 0, over cap, remaining never negative), the renewal date (1st of next
// month, UTC), the monthly conversation count, and the loader on the temp SQLite store (tenant-scoped).
import "@/lib/channels/__tests__/env-secrets";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { getData } from "@/lib/data";
import { loadUsageSummary } from "../data";
import { countConversationsThisMonth, monthStart, renewalDate, usageMeter } from "../usage";

describe("usageMeter", () => {
  it("normal usage", () => {
    expect(usageMeter(1000, 300, 120)).toEqual({ used: 420, cap: 1000, percent: 42, remaining: 580, overCap: false, noCap: false });
    expect(usageMeter(3, 1, 0).percent).toBe(33); // rounded down
    expect(usageMeter(1000, 0, 0)).toMatchObject({ percent: 0, remaining: 1000, overCap: false });
  });
  it("cap 0: no budget, 100%, remaining 0", () => {
    expect(usageMeter(0, 0, 0)).toEqual({ used: 0, cap: 0, percent: 100, remaining: 0, overCap: false, noCap: true });
    expect(usageMeter(0, 5, 5)).toMatchObject({ noCap: true, overCap: true, remaining: 0, percent: 100 });
  });
  it("over the cap: percent capped at 100, remaining never negative", () => {
    expect(usageMeter(1000, 900, 400)).toEqual({ used: 1300, cap: 1000, percent: 100, remaining: 0, overCap: true, noCap: false });
    expect(usageMeter(1000, 600, 400)).toMatchObject({ percent: 100, remaining: 0, overCap: true });
  });
  it("garbage in -> safe numbers", () => {
    expect(usageMeter(-5, -1, Number.NaN)).toMatchObject({ cap: 0, used: 0, remaining: 0, noCap: true });
    expect(usageMeter("2000", "10", null)).toMatchObject({ cap: 2000, used: 10, remaining: 1990 });
  });
});

describe("dates", () => {
  it("renews on the 1st of next month (UTC), also across the year end", () => {
    expect(renewalDate(new Date("2026-11-19T12:00:00Z")).toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(renewalDate(new Date("2026-12-31T23:59:59Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
    // 30 Nov 20:00 in Mexico City is already 1 Dec UTC: the UTC month decides.
    expect(renewalDate(new Date("2026-12-01T02:00:00Z")).toISOString()).toBe("2027-01-01T00:00:00.000Z");
    expect(monthStart(new Date("2026-11-19T12:00:00Z")).toISOString()).toBe("2026-11-01T00:00:00.000Z");
  });
  it("counts real-customer conversations of this UTC month only", () => {
    const now = new Date("2026-11-19T12:00:00Z");
    expect(countConversationsThisMonth([
      { channel: "telegram", lastMessageAt: "2026-11-01T00:00:00Z" },
      { channel: "whatsapp", lastMessageAt: "2026-11-30T23:59:59Z" },
      { channel: "simulator", lastMessageAt: "2026-11-10T00:00:00Z" },
      { channel: "telegram", lastMessageAt: "2026-10-31T23:59:59Z" },
      { channel: "telegram", lastMessageAt: "2026-12-01T00:00:00Z" },
      { channel: "telegram", lastMessageAt: "not a date" },
    ], now)).toBe(2);
  });
  it("seeded demo conversations do not count as real customers (P2-24)", () => {
    const now = new Date("2026-11-19T12:00:00Z");
    expect(countConversationsThisMonth([
      { channel: "telegram", externalId: "demo-andrea", lastMessageAt: "2026-11-10T00:00:00Z" },
      { channel: "telegram", externalId: "123", state: { demo: true }, lastMessageAt: "2026-11-10T00:00:00Z" },
      { channel: "telegram", externalId: "5215512345678", lastMessageAt: "2026-11-10T00:00:00Z" },
    ], now)).toBe(1);
  });
});

describe("loadUsageSummary (SQLite)", () => {
  it("reads the active tenant's plan, tokens and conversations only", async () => {
    const data = getData();
    const A = await data.tenants.ensure(`usa-${randomUUID()}`, "A"), B = await data.tenants.ensure(`usb-${randomUUID()}`, "B");
    const now = new Date();
    await data.usage.record(A, { inputTokens: 1000, outputTokens: 500 }, now);
    await data.usage.record(B, { inputTokens: 9_000_000, outputTokens: 0 }, now);
    await data.conversations.getOrCreate(A, "telegram", `a-${randomUUID()}`, "Cliente");
    await data.conversations.getOrCreate(A, "simulator", `sim-${randomUUID()}`, "Prueba");
    await data.conversations.getOrCreate(B, "telegram", `b-${randomUUID()}`, "Otro");
    const cap = (await data.tenants.get(A))!.aiMonthlyTokenCap;

    const a = await loadUsageSummary(A, now);
    expect(a.ai).toMatchObject({ used: 1500, cap, remaining: cap - 1500 });
    expect(a.conversations).toBe(1);
    expect(a.conversationsCapped).toBe(false);
    expect(a.renewsAt.getTime()).toBe(renewalDate(now).getTime());
    const b = await loadUsageSummary(B, now);
    expect(b.ai.used).toBe(9_000_000);
    expect(b.ai.remaining).toBe(Math.max(0, cap - 9_000_000));
  });
  it("unknown tenant fails closed (cap 0)", async () => {
    const r = await loadUsageSummary(`nope-${randomUUID()}`);
    expect(r.ai).toMatchObject({ cap: 0, remaining: 0, noCap: true });
  });
});
