// Extra wiring: real server actions / routes that sit between the UI and the engine.
import "./setup";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => (await import("./mocks")).headersMock());
vi.mock("next/cache", async () => (await import("./mocks")).cacheMock());

import { saveContextAction } from "@/app/(app)/context/actions";
import { saveToneAction } from "@/app/(app)/tone/actions";
import { connectChannel } from "@/app/(app)/channels/actions";
import { POST as simulatePOST, DELETE as simulateDELETE } from "@/app/api/inbox/simulate/route";
import { findTenantByChannelExternalId, listChunks } from "@/lib/store";
import { CONTEXT_SECTION_KEYS, type ContextSectionKey } from "@/lib/types";
import { asUser, CHEFMAN_CONTEXT, jsonReq, newTenant, stubFetch } from "./helpers";

afterEach(() => asUser(null));
/** The Context screen always posts ALL sections (ContextForm keeps a full record). */
const all = (over: Partial<Record<ContextSectionKey, string>>) =>
  Object.fromEntries(CONTEXT_SECTION_KEYS.map((k) => [k, over[k] ?? ""])) as Record<ContextSectionKey, string>;

describe("UI actions -> engine", () => {
  it("Context screen action saves + reindexes, and the simulator route answers from it (offline LLM)", async () => {
    const t = newTenant();
    asUser(t);
    const saved = await saveContextAction({ sections: all({ warranty: CHEFMAN_CONTEXT.warranty, shipping_returns: CHEFMAN_CONTEXT.shipping_returns }) });
    expect(saved).toEqual({ ok: true, changed: 2 });
    expect(listChunks(t.tenantId).filter((c) => c.sectionKey === "warranty").length).toBeGreaterThan(0);
    // saving the same content again changes nothing
    expect(await saveContextAction({ sections: all({ warranty: CHEFMAN_CONTEXT.warranty, shipping_returns: CHEFMAN_CONTEXT.shipping_returns }) })).toEqual({ ok: true, changed: 0 });
    // note: a partial payload is rejected (zod v4 z.record(z.enum) is exhaustive); fine because the UI always sends all keys
    expect((await saveContextAction({ sections: { warranty: "x" } })).ok).toBe(false);

    const res = await simulatePOST(jsonReq("https://inbox.test/api/inbox/simulate", { text: "¿Cuántos días tardan los envíos?" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reply: { text: string }; messages: { sender: string }[] };
    expect(body.reply.text).toMatch(/3 a 5 días hábiles/);
    expect(body.messages.map((m) => m.sender)).toEqual(["customer", "bot"]);
    expect((await simulateDELETE(jsonReq("https://inbox.test/api/inbox/simulate", null, undefined, "DELETE"))).status).toBe(200);
  });

  it("clearing a section removes its chunks (bot no longer answers from it)", async () => {
    const t = newTenant();
    asUser(t);
    expect((await saveContextAction({ sections: all({ warranty: CHEFMAN_CONTEXT.warranty }) })).changed).toBe(1);
    expect(listChunks(t.tenantId).filter((c) => c.sectionKey === "warranty").length).toBeGreaterThan(0);
    expect((await saveContextAction({ sections: all({}) })).changed).toBe(1);
    expect(listChunks(t.tenantId).filter((c) => c.sectionKey === "warranty")).toHaveLength(0);
  });

  it("FINDING-F (fixed): empty Tone greeting is stored as '' so the engine greets with the agent name", async () => {
    const t = newTenant();
    asUser(t);
    const r = await saveToneAction({ agentName: "Chefi", toneLevel: 3, languageDefault: "es", greeting: "", fallbackMessage: "", handoffEmail: "", crossSellLevel: 0, hours: { fromDay: 1, toDay: 5, open: "09:00", close: "18:00", timezone: "America/Mexico_City" } });
    expect(r.ok && r.greeting).toBe("");
    const sim = await simulatePOST(jsonReq("https://inbox.test/api/inbox/simulate", { text: "hola" }));
    expect(((await sim.json()) as { reply: { text: string } }).reply.text).toMatch(/Chefi/);
  });

  it("BUG-4 (fixed by uq_channel_external): a second tenant cannot take over a connected channel id; routing stays with the owner", async () => {
    stubFetch();
    const a = newTenant("A"), b = newTenant("B");
    const phone = `555${Date.now()}`;
    asUser(a);
    expect((await connectChannel("whatsapp", { externalId: phone, accessToken: "EAAG-token-A-123456", wabaId: "WABA_A" })).ok).toBe(true);
    asUser(b);
    let outcome: string;
    try {
      const res = await connectChannel("whatsapp", { externalId: phone, accessToken: "EAAG-token-B-123456", wabaId: "WABA_B" });
      outcome = res.ok ? "ok" : `refused:${res.error}`;
    } catch (e) {
      outcome = `threw:${e instanceof Error ? e.message : "?"}`;
    }
    expect(outcome).not.toBe("ok");
    // FINDING-H (fixed): a clean { ok:false, error:"in_use" } the UI explains ("Esa cuenta ya está conectada a otra marca")
    expect(outcome).toBe("refused:in_use");
    expect(findTenantByChannelExternalId("whatsapp", phone)).toBe(a.tenantId);
    vi.unstubAllGlobals();
  });
});
