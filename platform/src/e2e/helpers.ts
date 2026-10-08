// Shared e2e helpers. Import AFTER ./setup. Test files that touch auth must mock next/headers (see ./mocks.ts):
// the real auth.ts then reads the signed session cookie we set with asUser().
import fs from "node:fs";
import path from "node:path";
import { createHmac, randomUUID } from "node:crypto";
import { vi } from "vitest";
import { getDb } from "@/lib/db";
import { sign } from "@/lib/crypto";
import { hashPassword } from "@/lib/auth";
import { getAgentSettings, listMessages, saveContextSection } from "@/lib/store";
import { reindexSection } from "@/lib/context";
import type { LLM, LLMRequest } from "@/lib/engine/llm";
import type { ContextSectionKey } from "@/lib/types";
import { DATA_DIR, OUTBOX } from "./setup";

// ---------------- session (real auth.ts, cookie supplied through a mocked next/headers) ----------------
const G = globalThis as { __e2eCookie?: string };
export interface TestTenant { tenantId: string; userId: string; cookie: string }

export function newTenant(name = "Chefman"): TestTenant {
  const tenantId = `t${randomUUID().replace(/-/g, "")}`;
  const userId = randomUUID();
  const db = getDb();
  db.prepare("INSERT INTO tenants (id, name) VALUES (?, ?)").run(tenantId, name);
  db.prepare("INSERT INTO users (id, tenant_id, email, name, password_hash) VALUES (?,?,?,?,?)")
    .run(userId, tenantId, `admin-${tenantId}@example.test`, "Admin", hashPassword("not-a-real-password"));
  getAgentSettings(tenantId);
  const payload = `${userId}.${tenantId}.${Date.now() + 3_600_000}`;
  return { tenantId, userId, cookie: `${payload}.${sign(payload)}` };
}
export const asUser = (t: TestTenant | null) => { G.__e2eCookie = t?.cookie; };

// ---------------- knowledge ----------------
export const CHEFMAN_CONTEXT: Partial<Record<ContextSectionKey, string>> = {
  warranty: "Todos los productos Chefman tienen garantía de 1 año contra defectos de fábrica.\n\nPara hacer válida la garantía escribe a soporte@chefman.mx con tu ticket de compra.",
  shipping_returns: "Los envíos tardan de 3 a 5 días hábiles a todo México.\n\nTienes 30 días para devoluciones con el empaque original.",
  products: "## Freidora de aire 5L\nLa freidora de aire de 5 litros tiene canasta antiadherente apta para lavavajillas y 8 programas.\n\n## Licuadora de alta potencia\nLa licuadora de 1200 W tiene vaso de vidrio de 1.5 litros y 6 velocidades.",
  dos_donts: "Nunca prometas descuentos ni precios especiales.",
  escalation: "Quejas graves y temas de seguridad van a una persona.",
};

/** Same thing the Context screen does: store.saveContextSection + context.reindexSection. */
export function seedContext(tenantId: string, sections = CHEFMAN_CONTEXT) {
  for (const [k, v] of Object.entries(sections)) {
    saveContextSection(tenantId, k as ContextSectionKey, v!);
    reindexSection(tenantId, k as ContextSectionKey, v!);
  }
}

/**
 * Fake OpenAI (injected through EngineDeps.llm): a "faithful" model that copies the first sentence of the
 * top source, or answers [HANDOFF] when there is no source. Records every request.
 */
export function faithfulLLM() {
  const calls: LLMRequest[] = [];
  const llm: LLM = async (req) => {
    calls.push(req);
    const top = req.sources[0];
    if (!top) return "[HANDOFF]";
    return top.text.split(/(?<=[.!?])\s+|\n+/).find((s) => s.trim().length > 3)?.trim() ?? "[HANDOFF]";
  };
  return { llm, calls };
}

// ---------------- network stub (Meta Graph + OpenAI) ----------------
export interface FetchCall { url: string; method: string; headers: Record<string, string>; body: unknown }
export function stubFetch(opts: { graphStatus?: number; openaiReply?: string } = {}) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let body: unknown = init?.body;
    try { body = JSON.parse(String(init?.body ?? "")); } catch { /* keep raw */ }
    calls.push({ url, method: init?.method ?? "GET", headers: Object.fromEntries(new Headers(init?.headers).entries()), body });
    if (url.startsWith("https://api.openai.com/")) {
      return new Response(JSON.stringify({ choices: [{ message: { content: opts.openaiReply ?? "[HANDOFF]" } }] }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.startsWith("https://graph.facebook.com/") && (init?.method ?? "GET") === "GET") {
      // credential test done by the Channels connect action: GET /{id}?fields=...
      return new Response(JSON.stringify({ id: "x", name: "Chefman MX", verified_name: "Chefman MX", display_phone_number: "+52 55 0000 0000" }), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (url.startsWith("https://graph.facebook.com/")) {
      const status = opts.graphStatus ?? 200;
      const payload = status === 200 ? { messages: [{ id: `wamid.out.${calls.length}` }], message_id: `m.out.${calls.length}` } : { error: { message: "(#131047) Re-engagement message", code: 131047 } };
      return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
    }
    throw new Error(`unexpected network call in e2e: ${url}`);
  });
  vi.stubGlobal("fetch", fn);
  return { calls, graph: () => calls.filter((c) => c.url.startsWith("https://graph.facebook.com/") && c.method === "POST"), openai: () => calls.filter((c) => c.url.startsWith("https://api.openai.com/")) };
}

// ---------------- Meta webhook payloads ----------------
export const metaSign = (raw: string, secret = process.env.META_APP_SECRET!) => `sha256=${createHmac("sha256", secret).update(raw, "utf8").digest("hex")}`;

export function whatsappPayload(o: { phoneNumberId: string; from: string; name?: string; text: string; id: string }) {
  return {
    object: "whatsapp_business_account",
    entry: [{
      id: "102290129340398",
      changes: [{
        field: "messages",
        value: {
          messaging_product: "whatsapp",
          metadata: { display_phone_number: "15550783881", phone_number_id: o.phoneNumberId },
          contacts: [{ profile: { name: o.name ?? "Juan Pérez" }, wa_id: o.from }],
          messages: [{ from: o.from, id: o.id, timestamp: String(Math.floor(Date.now() / 1000)), type: "text", text: { body: o.text } }],
        },
      }],
    }],
  };
}
export function messagingPayload(o: { object: "instagram" | "page"; accountId: string; sender: string; text: string; mid: string; echo?: boolean }) {
  const now = Date.now();
  return {
    object: o.object,
    entry: [{
      id: o.accountId, time: now,
      messaging: [{
        sender: { id: o.echo ? o.accountId : o.sender }, recipient: { id: o.echo ? o.sender : o.accountId }, timestamp: now,
        message: { mid: o.mid, text: o.text, ...(o.echo ? { is_echo: true } : {}) },
      }],
    }],
  };
}
export function signedRequest(payload: unknown, opts: { signature?: string | null } = {}) {
  const raw = JSON.stringify(payload);
  const headers: Record<string, string> = { "content-type": "application/json" };
  const sig = opts.signature === undefined ? metaSign(raw) : opts.signature;
  if (sig !== null) headers["x-hub-signature-256"] = sig;
  return new Request("https://inbox.test/api/webhooks/meta", { method: "POST", headers, body: raw });
}

// ---------------- outbox / misc ----------------
/** Outbox files for a conversation. Default: both the DATA_DIR outbox and the legacy cwd/data/outbox (BUG-1). */
export function outboxFilesFor(conversationId: string, dir?: string): string[] {
  const dirs = dir ? [dir] : [path.join(DATA_DIR, "outbox"), OUTBOX];
  return dirs.flatMap((d) => (fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith(`-${conversationId}.txt`)).map((f) => path.join(d, f)) : []));
}
export const readOutbox = (conversationId: string, dir?: string) => outboxFilesFor(conversationId, dir).map((f) => fs.readFileSync(f, "utf8")).join("\n---\n");
export const bodies = (tenantId: string, conversationId: string) => listMessages(tenantId, conversationId).map((m) => m.body);
export const routeCtx = (id: string) => ({ params: Promise.resolve({ id }) });
/** Same-origin browser request (the inbox routes have a CSRF Origin check). */
export const jsonReq = (url: string, body: unknown, origin = "https://inbox.test", method = "POST") =>
  new Request(url, { method, headers: { "content-type": "application/json", origin, "sec-fetch-site": origin === "https://inbox.test" ? "same-origin" : "cross-site" }, body: method === "DELETE" ? undefined : JSON.stringify(body) });
