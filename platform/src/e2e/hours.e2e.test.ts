// Scenarios 6 + 7: Tone screen business hours (context module) <-> engine business-hours logic and handoff wording.
import "./setup";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("./mocks")).headersMock());

import { serializeBusinessHours, parseBusinessHours as parseToneHours, DEFAULT_HOURS, hoursAreSaved, type BusinessHours as ToneHours } from "@/lib/context/settings";
import { formatBusinessHours, isOpenNow, parseBusinessHours } from "@/lib/engine/escalate";
import { saveToneAction } from "@/app/(app)/tone/actions";
import { handleInbound } from "@/lib/engine";
import { getAgentSettings, getOrCreateConversation, listMessages } from "@/lib/store";
import { asUser, newTenant, seedContext } from "./helpers";

const TZ = "America/Mexico_City"; // UTC-6 all year (no DST since 2022)
/** Local Mexico City wall time -> Date */
const mx = (isoLocal: string) => new Date(`${isoLocal}-06:00`);
const engineOpen = (h: ToneHours, at: Date) => isOpenNow(parseBusinessHours(serializeBusinessHours(h)), at);

afterEach(() => asUser(null));

describe("scenario 6: serializeBusinessHours (Tone) is understood by the engine", () => {
  const monFri: ToneHours = { fromDay: 1, toDay: 5, open: "09:00", close: "18:00", timezone: TZ };

  it.each([
    ["Mon 08:59", "2026-10-05T08:59:00", false],
    ["Mon 09:00", "2026-10-05T09:00:00", true],
    ["Mon 12:30", "2026-10-05T12:30:00", true],
    ["Mon 17:59", "2026-10-05T17:59:00", true],
    ["Mon 18:00", "2026-10-05T18:00:00", false],
    ["Fri 12:00", "2026-10-09T12:00:00", true],
    ["Sat 12:00", "2026-10-10T12:00:00", false],
    ["Sun 12:00", "2026-10-11T12:00:00", false],
  ])("Mon–Fri 09–18 at %s -> open=%s", (_l, local, expected) => {
    expect(engineOpen(monFri, mx(local))).toBe(expected);
  });

  it("uses the tenant timezone, not the server's (Mon 20:00 UTC = 14:00 CDMX open; Tue 01:00 UTC = Mon 19:00 CDMX closed)", () => {
    expect(engineOpen(monFri, new Date("2026-10-05T20:00:00Z"))).toBe(true);
    expect(engineOpen(monFri, new Date("2026-10-06T01:00:00Z"))).toBe(false);
    const tijuana: ToneHours = { ...monFri, timezone: "America/Tijuana" }; // UTC-7 in October (DST)
    expect(engineOpen(tijuana, new Date("2026-10-05T15:30:00Z"))).toBe(false); // 08:30 Tijuana
    expect(engineOpen(tijuana, new Date("2026-10-05T16:30:00Z"))).toBe(true);
  });

  it("wrap-around week (Sat..Tue) and single day (Sun only)", () => {
    const satTue: ToneHours = { fromDay: 6, toDay: 2, open: "10:00", close: "14:00", timezone: TZ };
    expect(engineOpen(satTue, mx("2026-10-10T11:00:00"))).toBe(true); // Sat
    expect(engineOpen(satTue, mx("2026-10-11T11:00:00"))).toBe(true); // Sun
    expect(engineOpen(satTue, mx("2026-10-06T11:00:00"))).toBe(true); // Tue
    expect(engineOpen(satTue, mx("2026-10-07T11:00:00"))).toBe(false); // Wed
    const sun: ToneHours = { fromDay: 7, toDay: 7, open: "09:00", close: "13:00", timezone: TZ };
    expect(engineOpen(sun, mx("2026-10-11T10:00:00"))).toBe(true);
    expect(engineOpen(sun, mx("2026-10-12T10:00:00"))).toBe(false);
  });

  it("round trip: the Tone screen reloads what it saved; engine summary text is human readable", () => {
    expect(parseToneHours(serializeBusinessHours(monFri))).toEqual(monFri);
    expect(formatBusinessHours(parseBusinessHours(serializeBusinessHours(monFri)), "es")).toBe("lun–vie 9:00–18:00");
    expect(formatBusinessHours(parseBusinessHours(serializeBusinessHours(monFri)), "en")).toBe("Mon–Fri 9:00–18:00");
    expect(formatBusinessHours(parseBusinessHours(serializeBusinessHours({ ...monFri, fromDay: 6, toDay: 2 })), "es")).toBe("lun–mar 9:00–18:00, sáb–dom 9:00–18:00");
  });

  it("fresh tenant (DB default '{}') -> engine treats hours as unknown, while the Tone screen shows Mon–Fri 9–18", () => {
    const t = newTenant();
    const raw = getAgentSettings(t.tenantId).businessHours;
    expect(raw).toBe("{}");
    expect(parseToneHours(raw)).toEqual(DEFAULT_HOURS);
    expect(parseBusinessHours(raw).configured).toBe(false);
    // FINDING-E (fixed): the Tone screen knows the hours are NOT saved and shows the default only as an unsaved proposal
    expect(hoursAreSaved(raw)).toBe(false);
    expect(hoursAreSaved(serializeBusinessHours(DEFAULT_HOURS))).toBe(true);
  });

  it("BUG-3 (fixed): hours that close at/after midnight (20:00–02:00, 09:00–00:00) are understood by the engine", () => {
    const late: ToneHours = { fromDay: 1, toDay: 5, open: "20:00", close: "02:00", timezone: TZ };
    expect(parseBusinessHours(serializeBusinessHours(late)).configured).toBe(true);
    expect(engineOpen(late, mx("2026-10-05T19:59:00"))).toBe(false); // Mon before opening
    expect(engineOpen(late, mx("2026-10-05T23:00:00"))).toBe(true); // Mon night
    expect(engineOpen(late, mx("2026-10-06T01:30:00"))).toBe(true); // Tue early morning = Mon's shift
    expect(engineOpen(late, mx("2026-10-06T02:00:00"))).toBe(false);
    expect(engineOpen(late, mx("2026-10-10T01:00:00"))).toBe(true); // Sat 01:00 = Fri's shift
    expect(engineOpen(late, mx("2026-10-11T01:00:00"))).toBe(false); // Sun 01:00: no Sat shift
    expect(formatBusinessHours(parseBusinessHours(serializeBusinessHours(late)), "es")).toBe("lun–vie 20:00–2:00");
    const midnight: ToneHours = { fromDay: 1, toDay: 5, open: "09:00", close: "00:00", timezone: TZ };
    expect(engineOpen(midnight, mx("2026-10-05T23:59:00"))).toBe(true);
    expect(engineOpen(midnight, mx("2026-10-06T00:00:00"))).toBe(false);
    expect(engineOpen(midnight, mx("2026-10-06T08:59:00"))).toBe(false);
    expect(formatBusinessHours(parseBusinessHours(serializeBusinessHours(midnight)), "es")).toBe("lun–vie 9:00–24:00");
  });

  it("BUG-3 (fixed): the Tone action accepts an overnight range and rejects open == close", async () => {
    const t = newTenant();
    asUser(t);
    const base = { agentName: "Chefi", toneLevel: 3, languageDefault: "es", greeting: "", fallbackMessage: "", handoffEmail: "", crossSellLevel: 0 };
    expect((await saveToneAction({ ...base, hours: { fromDay: 1, toDay: 5, open: "20:00", close: "02:00", timezone: TZ } })).ok).toBe(true);
    expect(parseBusinessHours(getAgentSettings(t.tenantId).businessHours).configured).toBe(true);
    expect((await saveToneAction({ ...base, hours: { fromDay: 1, toDay: 5, open: "09:00", close: "09:00", timezone: TZ } })).ok).toBe(false);
  });
});

describe("scenario 7: saved business hours drive the handoff wording", () => {
  async function tenantWithTone(over: Partial<{ toneLevel: number; languageDefault: "es" | "en" }> = {}) {
    const t = newTenant();
    seedContext(t.tenantId);
    asUser(t);
    const res = await saveToneAction({
      agentName: "Chefi", toneLevel: over.toneLevel ?? 3, languageDefault: over.languageDefault ?? "es", greeting: "", fallbackMessage: "",
      handoffEmail: "soporte@chefman.test", crossSellLevel: 0,
      hours: { fromDay: 1, toDay: 5, open: "09:00", close: "18:00", timezone: TZ },
    });
    expect(res.ok).toBe(true);
    asUser(null);
    return t;
  }
  let k = 0;
  const ask = (tenantId: string, text: string, at: Date) =>
    handleInbound({ tenantId, channel: "simulator", externalId: `h-${++k}`, text, providerMessageId: `h-${k}` }, { now: () => at });

  it("outside hours (Sunday): Spanish handoff says we are closed and shows the saved hours", async () => {
    const t = await tenantWithTone();
    const r = await ask(t.tenantId, "quiero hablar con una persona", mx("2026-10-11T12:00:00"));
    expect(r).toMatchObject({ escalated: true, reason: "human_request" });
    expect(r.text).toMatch(/fuera de nuestro horario de atención \(lun–vie 9:00–18:00\)/);
    expect(r.text).toMatch(/te responderá por este medio en cuanto abramos/);
    const last = listMessages(t.tenantId, getOrCreateConversation(t.tenantId, "simulator", `h-${k}`).id).at(-1)!;
    expect(last.meta.outsideHours).toBe(true);
  });

  it("weekday after closing (Mon 18:30) is outside hours; Mon 10:00 says 'en breve'", async () => {
    const t = await tenantWithTone();
    expect((await ask(t.tenantId, "quiero hablar con una persona", mx("2026-10-05T18:30:00"))).text).toMatch(/fuera de nuestro horario/);
    const open = await ask(t.tenantId, "quiero hablar con una persona", mx("2026-10-05T10:00:00"));
    expect(open.text).toMatch(/Una persona te contactará por este medio en breve\./);
    expect(open.text).not.toMatch(/fuera de nuestro horario/);
  });

  it("formal tone + safety + outside hours keeps the safety text and uses 'usted'", async () => {
    const t = await tenantWithTone({ toneLevel: 1 });
    const r = await ask(t.tenantId, "la freidora sacó humo", mx("2026-10-10T20:00:00"));
    expect(r.reason).toBe("safety");
    expect(r.text).toMatch(/desconéctelo/);
    expect(r.text).toMatch(/fuera de nuestro horario de atención \(lun–vie 9:00–18:00\), pero marcamos su caso como urgente y una persona de nuestro equipo lo revisará lo antes posible, a más tardar en cuanto abramos\./);
  });

  it("English customer outside hours gets English wording with English day names", async () => {
    const t = await tenantWithTone();
    const r = await ask(t.tenantId, "I want to talk to a human please", mx("2026-10-11T12:00:00"));
    expect(r.text).toMatch(/We are currently outside our business hours \(Mon–Fri 9:00–18:00\)\. Someone will reply here as soon as we open\./);
  });

  it("no_answer handoff (no custom fallback saved) uses the engine template + hours", async () => {
    const t = await tenantWithTone();
    const ext = `h-${++k}`;
    const at = mx("2026-10-11T12:00:00");
    await handleInbound({ tenantId: t.tenantId, channel: "simulator", externalId: ext, text: "¿Venden boletos para el concierto?" }, { now: () => at });
    const r = await handleInbound({ tenantId: t.tenantId, channel: "simulator", externalId: ext, text: "¿Tienen sucursal en Monterrey?" }, { now: () => at });
    expect(r.reason).toBe("no_answer");
    expect(r.text).toMatch(/^No tengo información suficiente para responderte/);
    expect(r.text).toMatch(/fuera de nuestro horario de atención \(lun–vie 9:00–18:00\)/);
  });
});
