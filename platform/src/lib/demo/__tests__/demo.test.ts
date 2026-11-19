import "./env";
import { beforeEach, describe, expect, it } from "vitest";
import { getDb } from "../../db";
import { assertDemoAllowed, resetDemo, seedDemo, DEMO_TENANT } from "../index";
import { getData } from "../../data";

const T = DEMO_TENANT;
const count = (sql: string, ...a: string[]) => (getDb().prepare(sql).get(...a) as { c: number }).c;
const NOW = new Date("2026-10-06T16:00:00.000Z");

beforeEach(async () => {
  const db = getDb();
  for (const t of ["messages", "conversations", "sources", "chunks", "context_sections", "addons", "audit_log", "agent_settings", "users"]) db.exec(`DELETE FROM ${t}`);
});

async function realData() {
  const db = getDb();
  db.prepare("INSERT INTO users (id, tenant_id, email, name, password_hash) VALUES ('u1', ?, 'admin@chefman.local', 'Admin', 'hash')").run(T);
  const c = await getData().conversations.getOrCreate(T, "whatsapp", "5215512345678", "Cliente Real");
  await getData().messages.add(T, c.id, { direction: "in", sender: "customer", body: "hola" });
  await getData().conversations.setStatus(T, c.id, "needs_human", "human_request");
  const s = await getData().sources.create(T, { kind: "link", title: "Mi fuente real", url: "https://example.com/x" });
  await getData().sections.saveContent(T, "business", "Texto real del negocio");
  return { convId: c.id, sourceId: s.id };
}

describe("demo seed", () => {
  it("populates every area", async () => {
    const r = await seedDemo(T, NOW);
    expect(r).toMatchObject({ conversations: 10, sources: 2, sections: 8 });

    const sections = await getData().sections.list(T);
    expect(sections).toHaveLength(8);
    expect(sections.every((s) => s.content.length > 100)).toBe(true);
    for (const s of sections) expect((await getData().chunks.list(T)).some((c) => c.sectionKey === s.key)).toBe(true);

    const st = await getData().settings.get(T);
    expect(st).toMatchObject({ agentName: "Chef", toneLevel: 4, greeting: "", crossSellLevel: 1, handoffEmail: "demo@example.com" });
    expect(JSON.parse(st.businessHours)).toMatchObject({ fromDay: 1, toDay: 5, open: "09:00", close: "18:00", timezone: "America/Mexico_City" });
    expect(await getData().settings.isToneSaved(T)).toBe(true);

    const src = await getData().sources.list(T);
    expect(src.map((s) => s.kind).sort()).toEqual(["file", "link"]);
    expect(src.every((s) => s.status === "indexed" && s.title.startsWith("[Demo] "))).toBe(true);
    expect((await getData().chunks.list(T)).some((c) => c.sourceId === src.find((s) => s.kind === "link")!.id)).toBe(true);

    const shop = await getData().addons.get(T, "shopify");
    expect(shop.status).toBe("connected");
    expect(shop.publicInfo.mock).toBe(true);

    const convs = await getData().conversations.list(T);
    expect(convs).toHaveLength(10);
    expect(convs.every((c) => c.externalId.startsWith("demo-"))).toBe(true);
    expect(new Set(convs.map((c) => c.channel))).toEqual(new Set(["whatsapp", "instagram", "messenger"]));
    const by = (s: string) => convs.filter((c) => c.status === s);
    expect(by("resolved").length).toBe(5);
    expect(by("human").length).toBe(1);
    expect(by("needs_human").length).toBe(4);
    expect(convs.find((c) => c.customerName === "Andrea Soto")).toMatchObject({ status: "needs_human", escalationReason: "safety", unread: 2 });
    expect(convs.find((c) => c.customerName === "Mariana Cruz")).toMatchObject({ status: "needs_human", escalationReason: "human_request", unread: 1 });
    expect(convs.find((c) => c.customerName === "Fernanda Ibarra")?.escalationReason).toBe("no_answer");
    expect(by("resolved").every((c) => c.unread === 0)).toBe(true);

    const all = (await Promise.all(convs.map((c) => getData().messages.list(T, c.id)))).flat();
    expect(all.some((m) => m.body.startsWith("[Foto]"))).toBe(true);
    expect(all.some((m) => m.sender === "agent")).toBe(true);
    expect(all.some((m) => m.body.includes("mi licuadora echó humo"))).toBe(true);
    expect(all.some((m) => /#1001/.test(m.body) && /Enviado/.test(m.body))).toBe(true);
    expect(all.some((m) => /#1003/.test(m.body) && /Entregado/.test(m.body))).toBe(true);
    // emails are masked in stored bodies
    expect(all.some((m) => m.body.includes("test@example.com"))).toBe(false);
    expect(all.some((m) => m.body.includes("t***@example.com"))).toBe(true);
    // timestamps within the last 3 days, never in the future
    for (const m of all) {
      const ts = Date.parse(m.createdAt);
      expect(ts).toBeLessThanOrEqual(NOW.getTime());
      expect(NOW.getTime() - ts).toBeLessThan(3 * 86_400_000);
    }
  });

  it("is idempotent", async () => {
    await seedDemo(T, NOW);
    const snap = () => [
      count("SELECT COUNT(*) c FROM conversations WHERE tenant_id=?", T), count("SELECT COUNT(*) c FROM messages WHERE tenant_id=?", T),
      count("SELECT COUNT(*) c FROM sources WHERE tenant_id=?", T), count("SELECT COUNT(*) c FROM chunks WHERE tenant_id=?", T),
      count("SELECT COUNT(*) c FROM audit_log WHERE tenant_id=?", T), count("SELECT COUNT(*) c FROM context_sections WHERE tenant_id=?", T),
    ];
    const a = snap();
    await seedDemo(T, NOW);
    await seedDemo(T, NOW);
    expect(snap()).toEqual(a);
  });

  it("--reset removes only demo rows and restores original content", async () => {
    const real = await realData();
    await seedDemo(T, NOW);
    expect((await getData().sections.list(T)).find((s) => s.key === "business")!.content).not.toBe("Texto real del negocio");
    expect(await resetDemo(T)).toEqual({ conversations: 10, sources: 2 });

    const convs = await getData().conversations.list(T);
    expect(convs.map((c) => c.id)).toEqual([real.convId]);
    expect(convs[0]).toMatchObject({ status: "needs_human", escalationReason: "human_request" });
    expect(await getData().messages.list(T, real.convId)).toHaveLength(1);
    expect((await getData().sources.list(T)).map((s) => s.id)).toEqual([real.sourceId]);
    expect(count("SELECT COUNT(*) c FROM users")).toBe(1);
    expect(count("SELECT COUNT(*) c FROM audit_log WHERE actor='demo'")).toBe(0);
    expect((await getData().sections.list(T)).find((s) => s.key === "business")!.content).toBe("Texto real del negocio");
    expect((await getData().sections.list(T)).filter((s) => s.content).length).toBe(1);
    expect((await getData().addons.get(T, "shopify")).status).toBe("disconnected");
    expect(await getData().settings.isToneSaved(T)).toBe(false);
    expect((await getData().chunks.list(T)).every((c) => c.sectionKey === "business" || c.sourceId === null)).toBe(true);
    expect((await getData().settings.get(T)).agentName).toBe("Asistente");
    expect(await resetDemo(T)).toEqual({ conversations: 0, sources: 0 });
  });
});

describe("demo safety", () => {
  it("refuses production and non-local PUBLIC_URL", async () => {
    expect(() => assertDemoAllowed({ NODE_ENV: "production" })).toThrow(/production/);
    expect(() => assertDemoAllowed({ PUBLIC_URL: "https://inbox.chefman.mx" })).toThrow(/PUBLIC_URL/);
    expect(() => assertDemoAllowed({ PUBLIC_URL: "not a url" })).toThrow(/PUBLIC_URL/);
    expect(() => assertDemoAllowed({ PUBLIC_URL: "http://localhost:3000" })).not.toThrow();
    expect(() => assertDemoAllowed({ PUBLIC_URL: "http://127.0.0.1:3000" })).not.toThrow();
    expect(() => assertDemoAllowed({})).not.toThrow();
  });
});
