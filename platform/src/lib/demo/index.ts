// Demo seed for the local database (tenant 'chefman'): `npm run demo` / `npm run demo -- --reset`.
// No network, no LLM, no Meta/Shopify. Everything it writes is fake and marked so reset removes ONLY demo rows:
//   conversations.external_id 'demo-*', sources.title '[Demo] *', audit_log.actor 'demo' (flag + snapshot rows).
// Users, passwords and real secrets are never read or written (only the demo store's `{ mock: true }` marker).
import { getData } from "../data";
import { CONTEXT_SECTION_KEYS, type ContextSectionKey } from "../types";
import { chunkText, deleteSourceRowAndLinks, reindexSection, serializeBusinessHours } from "../context";
import { maskEmailsInText } from "../engine/text";
import {
  DEMO_ACTOR, DEMO_FILE_SOURCE, DEMO_HOURS, DEMO_LINK_SOURCE, DEMO_PREFIX, DEMO_SECTIONS, DEMO_SETTINGS,
  DEMO_SOURCE_PREFIX, DEMO_TENANT,
} from "./content";
import { buildConversations } from "./conversations";
import type { DemoConv } from "./content";

export { DEMO_TENANT, DEMO_PREFIX, DEMO_SOURCE_PREFIX, DEMO_ACTOR };

const FLAG = "demo.flag";
const SNAPSHOT = "demo.snapshot";

/** Throws unless this is a local, non-production environment. Never prints env values. */
export function assertDemoAllowed(env: Record<string, string | undefined> = process.env): void {
  if (env.NODE_ENV === "production") throw new Error("demo seed refused: NODE_ENV=production");
  const url = (env.PUBLIC_URL ?? "").trim();
  if (url) {
    let host = "";
    try { host = new URL(url).hostname.toLowerCase(); } catch { /* invalid -> refuse */ }
    if (!(host === "localhost" || host === "127.0.0.1" || host === "[::1]" || host === "::1"))
      throw new Error("demo seed refused: PUBLIC_URL is not localhost/127.0.0.1");
  }
}

export interface DemoResult { conversations: number; messages: number; sources: number; sections: number }

async function removeDemoConversations(t: string): Promise<number> {
  const data = getData();
  const ids = await data.conversations.listIdsByExternalPrefix(t, DEMO_PREFIX);
  for (const id of ids) await data.conversations.delete(t, id);
  return ids.length;
}
async function removeDemoSources(t: string): Promise<number> {
  const demo = (await getData().sources.list(t)).filter((s) => s.title.startsWith(DEMO_SOURCE_PREFIX));
  for (const s of demo) await deleteSourceRowAndLinks(t, s.id); // also drops Context section links
  return demo.length;
}

interface Snapshot {
  sections: Record<string, string>;
  settings: { agentName: string; toneLevel: number; languageDefault: "es" | "en"; languageAlt: "es" | "en"; greeting: string; fallbackMessage: string; handoffEmail: string; businessHours: string; crossSellLevel: number } | null;
  addon: { status: string; mock: boolean };
}
const getSnapshot = async (t: string): Promise<Snapshot | null> => {
  const detail = await getData().audit.find(t, { actor: DEMO_ACTOR, action: SNAPSHOT });
  try { return detail !== null ? (JSON.parse(detail) as Snapshot) : null; } catch { return null; }
};

async function takeSnapshot(t: string): Promise<void> {
  if (await getSnapshot(t)) return; // keep the ORIGINAL state across re-runs
  const data = getData();
  const s = await data.settings.get(t);
  const addon = await data.addons.get(t, "shopify");
  const snap: Snapshot = {
    sections: Object.fromEntries((await data.sections.list(t)).map((x) => [x.key, x.content])),
    settings: {
      agentName: s.agentName, toneLevel: s.toneLevel, languageDefault: s.languageDefault, languageAlt: s.languageAlt,
      greeting: s.greeting, fallbackMessage: s.fallbackMessage, handoffEmail: s.handoffEmail, businessHours: s.businessHours,
      crossSellLevel: s.crossSellLevel,
    },
    addon: { status: addon.status, mock: addon.publicInfo.mock === true },
  };
  await data.audit.log(t, DEMO_ACTOR, SNAPSHOT, JSON.stringify(snap));
}

export async function seedDemo(tenantId: string = DEMO_TENANT, now: Date = new Date()): Promise<DemoResult> {
  assertDemoAllowed();
  const data = getData();
  await data.tenants.ensure(tenantId, "Chefman");
  await takeSnapshot(tenantId);

  // (1) context sections, saved + chunked/indexed
  for (const key of CONTEXT_SECTION_KEYS) {
    await data.sections.saveContent(tenantId, key, DEMO_SECTIONS[key]);
    await reindexSection(tenantId, key, DEMO_SECTIONS[key]);
  }

  // (2) agent settings; "tone saved" is the same marker the Tone page writes
  await data.settings.save(tenantId, { ...DEMO_SETTINGS, languageDefault: "es", languageAlt: "en", businessHours: serializeBusinessHours(DEMO_HOURS) });
  if (!(await data.settings.isToneSaved(tenantId))) await data.settings.markToneSaved(tenantId, DEMO_ACTOR);

  // (3) sources (idempotent: recreate)
  await removeDemoSources(tenantId);
  const link = await data.sources.create(tenantId, { kind: "link", title: DEMO_LINK_SOURCE.title, url: DEMO_LINK_SOURCE.url });
  await data.sources.updateStatus(tenantId, link.id, "indexed", undefined, DEMO_LINK_SOURCE.text);
  await data.chunks.replace(tenantId, { sourceId: link.id }, chunkText(DEMO_LINK_SOURCE.text, DEMO_LINK_SOURCE.title));
  const file = await data.sources.create(tenantId, { kind: "file", title: DEMO_FILE_SOURCE.title, filePath: DEMO_FILE_SOURCE.filePath });
  await data.sources.updateStatus(tenantId, file.id, "indexed", undefined, DEMO_FILE_SOURCE.text);
  await data.chunks.replace(tenantId, { sourceId: file.id }, chunkText(DEMO_FILE_SOURCE.text, DEMO_FILE_SOURCE.title));

  // (4) Shopify demo store, exactly like POST /api/shopify/demo (never replaces a real connection)
  const cur = await data.addons.get(tenantId, "shopify");
  if (cur.status !== "connected" || cur.publicInfo.mock === true) {
    await data.secrets.set(tenantId, "addon", "shopify", { mock: true });
    await data.addons.save(tenantId, "shopify", {
      status: "connected",
      publicInfo: { shop: "demo.myshopify.com", name: "Tienda de demostración", mock: true, mode: "demo" },
    });
    if (cur.status !== "connected") await data.audit.log(tenantId, DEMO_ACTOR, "shopify.connected", "demo");
  }

  // (5) conversations: written via messages.add, then timestamps adjusted
  await removeDemoConversations(tenantId);
  const convs = buildConversations(now);
  const messages = await writeDemoConversations(tenantId, convs, now);

  // flag row (one per tenant)
  if ((await data.audit.find(tenantId, { actor: DEMO_ACTOR, action: FLAG })) === null)
    await data.audit.log(tenantId, DEMO_ACTOR, FLAG, "demo data present");
  return { conversations: convs.length, messages, sources: 2, sections: CONTEXT_SECTION_KEYS.length };
}

/** Writes demo transcripts (external_id "demo-<key>", meta.demo) with backdated timestamps. Returns messages written. */
export async function writeDemoConversations(tenantId: string, convs: DemoConv[], now: Date): Promise<number> {
  const data = getData();
  let messages = 0;
  for (const c of convs) {
    const conv = await data.conversations.getOrCreate(tenantId, c.channel, `${DEMO_PREFIX}${c.key}`, c.name);
    let t = now.getTime() - c.startAgo * 60_000;
    const first = t;
    for (const m of c.msgs) {
      t += (m.mins ?? (m.from === "b" ? 0.2 : 1)) * 60_000;
      const body = m.from === "c" ? maskEmailsInText(m.text) : m.text;
      const msg = await data.messages.add(tenantId, conv.id, {
        direction: m.from === "c" ? "in" : "out", sender: m.from === "c" ? "customer" : m.from === "b" ? "bot" : "agent",
        body, meta: { demo: true, lang: "es", ...(m.meta ?? {}) },
      });
      await data.messages.setCreatedAt(tenantId, msg.id, new Date(Math.min(t, now.getTime())).toISOString());
      messages++;
    }
    await data.conversations.setState(tenantId, conv.id, { lang: "es", greeted: true, botTurns: c.msgs.filter((m) => m.from === "b").length, demo: true });
    await data.conversations.setStatus(tenantId, conv.id, c.status, c.reason ?? null);
    await data.conversations.setTimestamps(tenantId, conv.id, {
      unread: c.unread, createdAt: new Date(first).toISOString(), lastMessageAt: new Date(Math.min(t, now.getTime())).toISOString(),
    });
  }
  return messages;
}

export async function resetDemo(tenantId: string = DEMO_TENANT): Promise<{ conversations: number; sources: number }> {
  const data = getData();
  const conversations = await removeDemoConversations(tenantId);
  const sources = await removeDemoSources(tenantId);
  const snap = await getSnapshot(tenantId);

  // Context sections and settings: restore the original ONLY where they still hold the demo values (never clobber edits).
  if (snap) {
    const now = new Map((await data.sections.list(tenantId)).map((s) => [s.key, s.content]));
    for (const key of CONTEXT_SECTION_KEYS as readonly ContextSectionKey[]) {
      if (now.get(key) !== DEMO_SECTIONS[key]) continue;
      const prev = snap.sections[key] ?? "";
      await data.sections.saveContent(tenantId, key, prev);
      await reindexSection(tenantId, key, prev);
    }
    const s = await data.settings.get(tenantId);
    if (snap.settings && s.agentName === DEMO_SETTINGS.agentName && s.handoffEmail === DEMO_SETTINGS.handoffEmail && s.businessHours === serializeBusinessHours(DEMO_HOURS))
      await data.settings.save(tenantId, snap.settings as never);
    const a = await data.addons.get(tenantId, "shopify");
    if (a.publicInfo.mock === true && snap.addon.status !== "connected") await data.addons.save(tenantId, "shopify", { status: "disconnected" });
  }
  await data.audit.deleteByActor(tenantId, DEMO_ACTOR);
  return { conversations, sources };
}
