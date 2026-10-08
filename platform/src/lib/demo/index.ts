// Demo seed for the local database (tenant 'chefman'): `npm run demo` / `npm run demo -- --reset`.
// No network, no LLM, no Meta/Shopify. Everything it writes is fake and marked so reset removes ONLY demo rows:
//   conversations.external_id 'demo-*', sources.title '[Demo] *', audit_log.actor 'demo' (flag + snapshot rows).
// Users, passwords and secrets are never read or written.
import { getDb } from "../db";
import {
  addMessage, audit, getAddon, getAgentSettings, getContextSections, createSource, replaceChunks,
  saveAddon, saveAgentSettings, saveContextSection, setConversationState, setConversationStatus, getOrCreateConversation,
  updateSourceStatus,
} from "../store";
import { CONTEXT_SECTION_KEYS, type ContextSectionKey } from "../types";
import { chunkText, deleteSourceRowAndLinks, reindexSection, serializeBusinessHours } from "../context";
import { isToneSaved } from "../context/tone-saved";
import { maskEmailsInText } from "../engine/text";
import {
  DEMO_ACTOR, DEMO_FILE_SOURCE, DEMO_HOURS, DEMO_LINK_SOURCE, DEMO_PREFIX, DEMO_SECTIONS, DEMO_SETTINGS,
  DEMO_SOURCE_PREFIX, DEMO_TENANT,
} from "./content";
import { buildConversations } from "./conversations";

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

type Row = Record<string, unknown>;
const demoConvIds = (t: string) =>
  (getDb().prepare("SELECT id FROM conversations WHERE tenant_id=? AND substr(external_id,1,?)=?").all(t, DEMO_PREFIX.length, DEMO_PREFIX) as Row[]).map((r) => r.id as string);

function removeDemoConversations(t: string): number {
  const db = getDb(); const ids = demoConvIds(t);
  for (const id of ids) {
    db.prepare("DELETE FROM messages WHERE tenant_id=? AND conversation_id=?").run(t, id);
    db.prepare("DELETE FROM conversations WHERE tenant_id=? AND id=?").run(t, id);
  }
  return ids.length;
}
function removeDemoSources(t: string): number {
  const rows = getDb().prepare("SELECT id FROM sources WHERE tenant_id=? AND substr(title,1,?)=?").all(t, DEMO_SOURCE_PREFIX.length, DEMO_SOURCE_PREFIX) as Row[];
  for (const r of rows) deleteSourceRowAndLinks(t, r.id as string); // also drops Context section links
  return rows.length;
}

interface Snapshot {
  sections: Record<string, string>;
  settings: { agentName: string; toneLevel: number; languageDefault: "es" | "en"; languageAlt: "es" | "en"; greeting: string; fallbackMessage: string; handoffEmail: string; businessHours: string; crossSellLevel: number } | null;
  addon: { status: string; mock: boolean };
}
const getSnapshot = (t: string): Snapshot | null => {
  const r = getDb().prepare("SELECT detail FROM audit_log WHERE tenant_id=? AND actor=? AND action=? LIMIT 1").get(t, DEMO_ACTOR, SNAPSHOT) as Row | undefined;
  try { return r ? (JSON.parse(String(r.detail)) as Snapshot) : null; } catch { return null; }
};

function takeSnapshot(t: string): void {
  if (getSnapshot(t)) return; // keep the ORIGINAL state across re-runs
  const s = getAgentSettings(t);
  const snap: Snapshot = {
    sections: Object.fromEntries(getContextSections(t).map((x) => [x.key, x.content])),
    settings: {
      agentName: s.agentName, toneLevel: s.toneLevel, languageDefault: s.languageDefault, languageAlt: s.languageAlt,
      greeting: s.greeting, fallbackMessage: s.fallbackMessage, handoffEmail: s.handoffEmail, businessHours: s.businessHours,
      crossSellLevel: s.crossSellLevel,
    },
    addon: { status: getAddon(t, "shopify").status, mock: getAddon(t, "shopify").publicInfo.mock === true },
  };
  audit(t, DEMO_ACTOR, SNAPSHOT, JSON.stringify(snap));
}

export function seedDemo(tenantId: string = DEMO_TENANT, now: Date = new Date()): DemoResult {
  assertDemoAllowed();
  const db = getDb();
  db.prepare("INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)").run(tenantId, "Chefman");
  takeSnapshot(tenantId);

  // (1) context sections, saved + chunked/indexed
  for (const key of CONTEXT_SECTION_KEYS) {
    saveContextSection(tenantId, key, DEMO_SECTIONS[key]);
    reindexSection(tenantId, key, DEMO_SECTIONS[key]);
  }

  // (2) agent settings; "tone saved" is the same audit marker the Tone page writes
  saveAgentSettings(tenantId, { ...DEMO_SETTINGS, languageDefault: "es", languageAlt: "en", businessHours: serializeBusinessHours(DEMO_HOURS) });
  if (!isToneSaved(tenantId)) audit(tenantId, DEMO_ACTOR, "settings.save", "tone");

  // (3) sources (idempotent: recreate)
  removeDemoSources(tenantId);
  const link = createSource(tenantId, { kind: "link", title: DEMO_LINK_SOURCE.title, url: DEMO_LINK_SOURCE.url });
  updateSourceStatus(tenantId, link.id, "indexed", undefined, DEMO_LINK_SOURCE.text);
  replaceChunks(tenantId, { sourceId: link.id }, chunkText(DEMO_LINK_SOURCE.text, DEMO_LINK_SOURCE.title));
  const file = createSource(tenantId, { kind: "file", title: DEMO_FILE_SOURCE.title, filePath: DEMO_FILE_SOURCE.filePath });
  updateSourceStatus(tenantId, file.id, "indexed", undefined, DEMO_FILE_SOURCE.text);
  replaceChunks(tenantId, { sourceId: file.id }, chunkText(DEMO_FILE_SOURCE.text, DEMO_FILE_SOURCE.title));

  // (4) Shopify demo store, exactly like POST /api/shopify/demo (never replaces a real connection)
  const cur = getAddon(tenantId, "shopify");
  if (cur.status !== "connected" || cur.publicInfo.mock === true) {
    saveAddon(tenantId, "shopify", {
      status: "connected", secrets: { mock: true },
      publicInfo: { shop: "demo.myshopify.com", name: "Tienda de demostración", mock: true, mode: "demo" },
    });
    if (cur.status !== "connected") audit(tenantId, DEMO_ACTOR, "shopify.connected", "demo");
  }

  // (5) conversations: written via addMessage, then timestamps adjusted
  removeDemoConversations(tenantId);
  let messages = 0;
  const convs = buildConversations(now);
  for (const c of convs) {
    const conv = getOrCreateConversation(tenantId, c.channel, `${DEMO_PREFIX}${c.key}`, c.name);
    let t = now.getTime() - c.startAgo * 60_000;
    const first = t;
    for (const m of c.msgs) {
      t += (m.mins ?? (m.from === "b" ? 0.2 : 1)) * 60_000;
      const body = m.from === "c" ? maskEmailsInText(m.text) : m.text;
      const msg = addMessage(tenantId, conv.id, {
        direction: m.from === "c" ? "in" : "out", sender: m.from === "c" ? "customer" : m.from === "b" ? "bot" : "agent",
        body, meta: { demo: true, lang: "es", ...(m.meta ?? {}) },
      });
      db.prepare("UPDATE messages SET created_at=? WHERE id=?").run(new Date(Math.min(t, now.getTime())).toISOString(), msg.id);
      messages++;
    }
    setConversationState(tenantId, conv.id, { lang: "es", greeted: true, botTurns: c.msgs.filter((m) => m.from === "b").length, demo: true });
    setConversationStatus(tenantId, conv.id, c.status, c.reason ?? null);
    db.prepare("UPDATE conversations SET unread=?, created_at=?, last_message_at=? WHERE tenant_id=? AND id=?")
      .run(c.unread, new Date(first).toISOString(), new Date(Math.min(t, now.getTime())).toISOString(), tenantId, conv.id);
  }

  // flag row (one per tenant)
  if (!db.prepare("SELECT 1 FROM audit_log WHERE tenant_id=? AND actor=? AND action=?").get(tenantId, DEMO_ACTOR, FLAG))
    audit(tenantId, DEMO_ACTOR, FLAG, "demo data present");
  return { conversations: convs.length, messages, sources: 2, sections: CONTEXT_SECTION_KEYS.length };
}

export function resetDemo(tenantId: string = DEMO_TENANT): { conversations: number; sources: number } {
  const conversations = removeDemoConversations(tenantId);
  const sources = removeDemoSources(tenantId);
  const snap = getSnapshot(tenantId);

  // Context sections and settings: restore the original ONLY where they still hold the demo values (never clobber edits).
  if (snap) {
    const now = new Map(getContextSections(tenantId).map((s) => [s.key, s.content]));
    for (const key of CONTEXT_SECTION_KEYS as readonly ContextSectionKey[]) {
      if (now.get(key) !== DEMO_SECTIONS[key]) continue;
      const prev = snap.sections[key] ?? "";
      saveContextSection(tenantId, key, prev);
      reindexSection(tenantId, key, prev);
    }
    const s = getAgentSettings(tenantId);
    if (snap.settings && s.agentName === DEMO_SETTINGS.agentName && s.handoffEmail === DEMO_SETTINGS.handoffEmail && s.businessHours === serializeBusinessHours(DEMO_HOURS))
      saveAgentSettings(tenantId, snap.settings as never);
    const a = getAddon(tenantId, "shopify");
    if (a.publicInfo.mock === true && snap.addon.status !== "connected") saveAddon(tenantId, "shopify", { status: "disconnected" });
  }
  getDb().prepare("DELETE FROM audit_log WHERE tenant_id=? AND actor=?").run(tenantId, DEMO_ACTOR);
  return { conversations, sources };
}
