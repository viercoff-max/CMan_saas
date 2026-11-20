// Demo businesses ("Crear negocio demo"): template content, seeding into a new tenant, and the delete guards
// (demo mark required, legal hold kept, never touches another tenant).
import "./env";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDb } from "../../db";
import { getData } from "../../data";
import { CONTEXT_SECTION_KEYS } from "../../types";
import { deleteDemoBusiness, demoSlug, isDemoBusiness, seedDemoBusiness } from "../business";
import { DEMO_TEMPLATE_KEYS, DEMO_TEMPLATES, isDemoTemplate } from "../templates";
import { isReservedSlug, SLUG_RE } from "../../auth/slug";

const A = "demo-tenant-a";
const B = "real-tenant-b";
const NOW = new Date("2026-11-20T16:00:00.000Z");

beforeEach(() => {
  const db = getDb();
  for (const t of ["messages", "conversations", "sources", "chunks", "context_sections", "addons", "audit_log", "agent_settings", "brand_settings", "users"]) {
    try { db.exec(`DELETE FROM ${t}`); } catch { /* table may not exist in this schema version */ }
  }
});
afterEach(() => vi.restoreAllMocks());

describe("demo templates", () => {
  it.each(DEMO_TEMPLATE_KEYS)("%s fills every context section and only uses the chosen name", (k) => {
    const tpl = DEMO_TEMPLATES[k];
    const s = tpl.sections("Mi Negocio Prueba");
    for (const key of CONTEXT_SECTION_KEYS) expect(s[key]?.trim().length, key).toBeGreaterThan(40);
    const all = Object.values(s).join("\n") + tpl.conversations(NOW, "Mi Negocio Prueba").flatMap((c) => c.msgs.map((m) => m.text)).join("\n");
    expect(all).not.toMatch(/Chefman/); // the local demo brand never leaks into other businesses
    expect(all).toContain("Mi Negocio Prueba");
    expect(/^#[0-9A-F]{6}$/i.test(tpl.brand.primaryColor)).toBe(true);
  });

  it("template keys are validated", () => {
    expect(isDemoTemplate("moda")).toBe(true);
    expect(isDemoTemplate("hack")).toBe(false);
    expect(isDemoTemplate(undefined)).toBe(false);
  });

  it("demo slugs are valid, never the reserved word and random", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 50; i++) {
      const s = demoSlug();
      expect(SLUG_RE.test(s)).toBe(true);
      expect(isReservedSlug(s)).toBe(false);
      seen.add(s);
    }
    expect(seen.size).toBeGreaterThan(45);
  });
});

describe("seedDemoBusiness", () => {
  it("fills context, tone, brand, demo store and conversations, and marks the tenant as demo", async () => {
    const r = await seedDemoBusiness(A, "cafe", "Café Prueba", NOW);
    expect(r.sections).toBe(CONTEXT_SECTION_KEYS.length);
    expect(r.conversations).toBe(3);
    expect(await isDemoBusiness(A)).toBe(true);
    expect((await getData().sections.list(A)).every((s) => s.content.length > 40)).toBe(true);
    expect((await getData().settings.get(A)).agentName).toBe("Aurora");
    expect((await getData().brand.get(A)).displayName).toBe("Café Prueba");
    expect((await getData().addons.get(A, "shopify")).status).not.toBe("connected"); // cafe has no store
    expect((await getData().conversations.list(A)).every((c) => c.externalId.startsWith("demo-"))).toBe(true);

    await seedDemoBusiness(B, "moda", "Moda Prueba", NOW);
    expect((await getData().addons.get(B, "shopify")).publicInfo.mock).toBe(true);
  });

  it("does not write into any other tenant (cross-tenant negative)", async () => {
    await getData().sections.saveContent(B, "business", "Texto real de B");
    await seedDemoBusiness(A, "cocina", "Cocina Prueba", NOW);
    expect(await isDemoBusiness(B)).toBe(false);
    expect((await getData().sections.list(B)).find((s) => s.key === "business")?.content).toBe("Texto real de B");
    expect(await getData().conversations.list(B)).toHaveLength(0);
  });
});

describe("deleteDemoBusiness", () => {
  it("refuses a business that is not a demo (a real tenant can never be deleted this way)", async () => {
    const remove = vi.spyOn(getData().tenants, "remove");
    await getData().sections.saveContent(B, "business", "Texto real");
    expect(await deleteDemoBusiness(B)).toEqual({ ok: false, error: "not_demo" });
    expect(remove).not.toHaveBeenCalled();
  });

  it("deletes only the demo tenant it was given", async () => {
    const remove = vi.spyOn(getData().tenants, "remove").mockResolvedValue(true);
    await seedDemoBusiness(A, "moda", "Moda Prueba", NOW);
    await seedDemoBusiness(B, "cafe", "Café B", NOW);
    expect(await deleteDemoBusiness(A)).toEqual({ ok: true });
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith(A);
  });

  it("keeps a demo business with a REAL conversation under legal hold", async () => {
    const remove = vi.spyOn(getData().tenants, "remove").mockResolvedValue(true);
    await seedDemoBusiness(A, "cocina", "Cocina Prueba", NOW); // its fake "demo-seguridad" case does not block deletion
    const c = await getData().conversations.getOrCreate(A, "telegram", "987654321", "Cliente real");
    await getData().messages.add(A, c.id, { direction: "in", sender: "customer", body: "mi licuadora echó humo" });
    await getData().conversations.setStatus(A, c.id, "needs_human", "safety");
    expect(await deleteDemoBusiness(A)).toEqual({ ok: false, error: "legal_hold" });
    expect(remove).not.toHaveBeenCalled();
  });

  it("the fake safety transcript of the template alone does not block deletion", async () => {
    vi.spyOn(getData().tenants, "remove").mockResolvedValue(true);
    await seedDemoBusiness(A, "cocina", "Cocina Prueba", NOW);
    expect(await deleteDemoBusiness(A)).toEqual({ ok: true });
  });

  it("SQLite (on-prem) cannot delete tenants: reported as failed, nothing thrown", async () => {
    await seedDemoBusiness(A, "cafe", "Café Prueba", NOW);
    expect(await deleteDemoBusiness(A)).toEqual({ ok: false, error: "failed" });
  });
});
