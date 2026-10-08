// Scenarios 1 + 3: context module -> chunks -> engine retrieval/LLM -> validator -> handoff outbox; deterministic escalations.
import { DATA_DIR } from "./setup";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { handleInbound } from "@/lib/engine";
import { getConversation, getOrCreateConversation, listChunks, listMessages } from "@/lib/store";
import type { Channel } from "@/lib/types";
import { faithfulLLM, newTenant, outboxFilesFor, readOutbox, seedContext } from "./helpers";

let tenantId: string;
let ext: string;
let n = 0;
const ev = (text: string, channel: Channel = "whatsapp") => ({ tenantId, channel, externalId: ext, customerName: "Juan Pérez", text, providerMessageId: `kn-${++n}` });
const conv = (channel: Channel = "whatsapp") => getOrCreateConversation(tenantId, channel, ext);

beforeEach(() => {
  tenantId = newTenant().tenantId;
  ext = `cust-${++n}`;
  seedContext(tenantId);
});

describe("scenario 1: answers come from the tenant's saved context", () => {
  it("context save + reindex produces chunks the engine can retrieve", () => {
    const chunks = listChunks(tenantId);
    expect(chunks.some((c) => c.sectionKey === "warranty" && /1 año/.test(c.text))).toBe(true);
    expect(chunks.some((c) => c.sectionKey === "products" && /Licuadora/.test(c.title))).toBe(true);
  });

  it("warranty question: LLM gets only matching tenant sources + always-on rules; reply is grounded", async () => {
    const { llm, calls } = faithfulLLM();
    const r = await handleInbound(ev("¿Cuánto dura la garantía de mis productos?"), { llm });
    expect(r.escalated).toBe(false);
    expect(calls).toHaveLength(1);
    const req = calls[0];
    expect(req.sources.length).toBeGreaterThan(0);
    expect(req.sources.every((s) => s.tenantId === tenantId)).toBe(true);
    expect(req.sources[0].sectionKey).toBe("warranty");
    // always-on sections go into the system prompt, never as retrievable sources
    expect(req.sources.some((s) => s.sectionKey === "dos_donts" || s.sectionKey === "escalation")).toBe(false);
    expect(req.system).toMatch(/Nunca prometas descuentos/);
    expect(r.text).toMatch(/garantía de 1 año contra defectos de fábrica/);
    // every sentence of the reply after the greeting exists verbatim in the tenant context
    const answer = r.text.replace(/^.*?(Todos)/, "$1").split("\n\n")[0];
    expect(listChunks(tenantId).some((c) => c.text.includes(answer))).toBe(true);
    const bot = listMessages(tenantId, conv().id).at(-1)!;
    expect(bot.sender).toBe("bot");
    expect(bot.meta.sources).toEqual(req.sources.map((s) => s.id));
  });

  it("product question is answered from the products section", async () => {
    const { llm, calls } = faithfulLLM();
    const r = await handleInbound(ev("¿La licuadora tiene vaso de vidrio?"), { llm });
    expect(calls[0].sources[0].title).toMatch(/Licuadora/);
    expect(r.text).toMatch(/vaso de vidrio de 1.5 litros/);
  });

  it("an LLM that invents a promo is blocked by the validator and handed off", async () => {
    const r = await handleInbound(ev("¿Cuánto dura la garantía?"), { llm: async () => "La garantía es de 1 año y hoy tienes 20% de descuento con el cupón CHEF20." });
    expect(r).toMatchObject({ escalated: true, reason: "no_answer" });
    expect(r.text).not.toMatch(/20%|descuento|CHEF20/);
  });

  it("FINDING-G (fixed): an LLM that invents a numeric FACT (duration/price not in the sources) is blocked and handed off", async () => {
    const r = await handleInbound(ev("¿Cuánto dura la garantía?"), { llm: async () => "La garantía es de 5 años y cubre caídas." });
    expect(r).toMatchObject({ escalated: true, reason: "no_answer" });
    expect(r.text).not.toMatch(/5 años/); // sources say 1 año
  });

  it("unknown question: clarify once, second unknown escalates needs_human, LLM never called, outbox file written", async () => {
    const { llm, calls } = faithfulLLM();
    const r1 = await handleInbound(ev("¿Venden boletos para el concierto de rock?"), { llm });
    expect(r1.escalated).toBe(false);
    expect(r1.text).toMatch(/no encontré información/i);
    const r2 = await handleInbound(ev("¿Tienen estacionamiento para bicicletas?"), { llm });
    expect(r2).toMatchObject({ escalated: true, reason: "no_answer" });
    expect(calls).toHaveLength(0);
    const c = getConversation(tenantId, conv().id)!;
    expect(c.status).toBe("needs_human");
    expect(c.escalationReason).toBe("no_answer");
    // real notifyHandoff (not injected) wrote an email-like file
    const files = outboxFilesFor(c.id);
    expect(files).toHaveLength(1);
    const mail = readOutbox(c.id);
    expect(mail).toMatch(/^To: /);
    expect(mail).toMatch(/Motivo: no_answer/);
    expect(mail).toMatch(/Cliente: Juan Pérez/);
    expect(mail).toContain(`Abrir conversación: https://inbox.test/inbox?c=${c.id}`);
    expect(mail).toMatch(/Cliente: ¿Venden boletos/);
    // bot stays silent afterwards
    expect((await handleInbound(ev("¿hola?"), { llm })).text).toBe("");
  });

  it("BUG-1 (fixed): handoff outbox is written under DATA_DIR (not process.cwd()/data)", async () => {
    await handleInbound(ev("quiero hablar con una persona"));
    expect(outboxFilesFor(conv().id, path.join(DATA_DIR, "outbox"))).toHaveLength(1);
  });

  it("offline fallback through defaultLLM (no OPENAI_API_KEY) still answers from context", async () => {
    const r = await handleInbound(ev("¿Cuántos días tardan los envíos?"));
    expect(r.text).toMatch(/3 a 5 días hábiles/);
  });
});

describe("scenario 3: deterministic escalations and language", () => {
  it("safety: 'mi licuadora sacó humo' escalates immediately with reason safety", async () => {
    const { llm, calls } = faithfulLLM();
    const r = await handleInbound(ev("mi licuadora sacó humo"), { llm });
    expect(r).toMatchObject({ escalated: true, reason: "safety" });
    expect(r.text).toMatch(/desconéctalo/);
    expect(r.text).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
    expect(calls).toHaveLength(0);
    const c = getConversation(tenantId, conv().id)!;
    expect([c.status, c.escalationReason]).toEqual(["needs_human", "safety"]);
    expect(readOutbox(c.id)).toMatch(/Subject: \[URGENTE\]/);
  });

  it("safety wins even in the middle of an order flow / with a question", async () => {
    const r = await handleInbound(ev("¿cuánto dura la garantía? la freidora echa chispas"), { llm: faithfulLLM().llm });
    expect(r.reason).toBe("safety");
  });

  it("legal: PROFECO / abogado escalate with reason legal", async () => {
    const r = await handleInbound(ev("Si no me responden voy a ir a PROFECO con mi abogado"));
    expect(r).toMatchObject({ escalated: true, reason: "legal" });
    expect(getConversation(tenantId, conv().id)!.escalationReason).toBe("legal");
    expect(readOutbox(conv().id)).toMatch(/\[URGENTE\]/);
  });

  it("human_request: 'quiero hablar con una persona'", async () => {
    const r = await handleInbound(ev("quiero hablar con una persona"));
    expect(r).toMatchObject({ escalated: true, reason: "human_request" });
    expect(r.text).toMatch(/te comunico con una persona/);
  });

  it("English message switches the reply language (knowledge + escalation)", async () => {
    const { llm, calls } = faithfulLLM();
    const r1 = await handleInbound(ev("Hi, how long is the warranty?"), { llm });
    expect(calls[0].lang).toBe("en");
    expect(r1.text).toMatch(/^Hi, I'm /);
    expect(conv().state.lang).toBe("en");
    const r2 = await handleInbound(ev("I want to talk to a human please"), { llm });
    expect(r2).toMatchObject({ escalated: true, reason: "human_request" });
    expect(r2.text).toMatch(/I'll connect you with someone from our team/);
  });

  it("English safety message gets the English safety template", async () => {
    const r = await handleInbound(ev("My blender started to smoke and I got a shock"));
    expect(r.reason).toBe("safety");
    expect(r.text).toMatch(/unplug it/);
  });
});

