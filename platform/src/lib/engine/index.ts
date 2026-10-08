// Conversation engine: one entry point for webhooks and the simulator.
// Pipeline: dedupe -> store inbound -> silence checks -> language -> deterministic escalation -> pending offer
//           -> order flow (templates only) -> knowledge (retrieval + LLM + validator) -> cross-sell -> store reply.
import type { AgentSettings, Conversation, EngineReply, InboundEvent, OrdersConnector } from "../types";
import {
  addMessage, getAgentSettings, getOrCreateConversation, listChunks,
  setConversationState, setConversationStatus,
} from "../store";
import { ALWAYS_ON_SECTIONS, getEffectiveSectionContent } from "../context/section-repo";
import { getOrdersConnector as defaultGetOrdersConnector } from "../connectors/registry";
import { notifyHandoff as defaultNotifyHandoff } from "../channels/handoff";
import { detectActionRequest, detectEscalation, formatBusinessHours, isOpenNow, parseBusinessHours, type EscalationReason } from "./escalate";
import { detectLanguage, type Lang } from "./lang";
import { defaultLLM, type LLM } from "./llm";
import { runOrderFlow, type LookupLimiter, type OrderState } from "./orders";
import { buildSystemPrompt, buildUserMessage, HANDOFF_TOKEN } from "./prompt";
import { hasProviderMessage, recentMessages } from "./repo";
import { isProductChunk, retrieve, type Retrieved } from "./retrieve";
import * as T from "./templates";
import * as C from "./copy";
import { attachmentReceived, parseMediaText, type MediaKind } from "./media";
import { INBOUND_WINDOW_MS, isLookupBlocked, MAX_INBOUND_PER_WINDOW, recordInbound, recordLookupFailure } from "./limiter";
import { isAffirmative, isComplaint, isGreetingOnly, isNegative, looksLikeInjection, maskEmailsInText, redactForLLM, redactPII } from "./text";
import { validateReply } from "./validate";
import { isLegacyDefault } from "../context/settings";

// Re-export pure helpers (handy for tests and other modules).
export { detectActionRequest, detectEscalation } from "./escalate";
export { mediaText, parseMediaText, MEDIA_LABEL, type MediaKind } from "./media";
export { detectLanguage } from "./lang";
export { extractEmail, extractOrderNumber, maskEmail, detectOrderIntent } from "./orders";
export { validateReply } from "./validate";
export { retrieve, tokenize } from "./retrieve";

export const MAX_BOT_TURNS = 20;
export const MAX_MISSES = 2;
const MAX_INBOUND_CHARS = 2000;

export interface EngineDeps {
  llm?: LLM;
  now?: () => Date;
  getOrdersConnector?: (tenantId: string) => OrdersConnector | null;
  notifyHandoff?: (tenantId: string, conversationId: string, reason: string) => Promise<void>;
}

/** Everything the engine remembers per conversation (conversation.state). Contains no PII except a transient email. */
export interface EngineState {
  lang?: Lang;
  greeted?: boolean;
  botTurns?: number;
  misses?: number;
  order?: OrderState;
  noConnectorTold?: boolean;
  /** Pending "¿te comunico con una persona?" offer; `kind` picks the handoff wording when accepted. */
  offer?: { reason: EscalationReason; kind?: T.HandoffKind };
  crossSellSent?: boolean;
  capOffered?: boolean;
  /** When the inbound throttle message was sent (ms epoch); the bot stays silent until the window clears. */
  throttledAt?: number;
}

/** InboundEvent plus optional engine-only fields (types.ts is shared; channels may pass `media`). */
export type EngineInboundEvent = InboundEvent & { media?: MediaKind };

interface Ctx {
  tenantId: string; conv: Conversation; settings: AgentSettings; tone: T.Tone; lang: Lang;
  state: EngineState; text: string; now: Date; deps: Required<EngineDeps>;
  media: { kind: MediaKind; caption: string } | null;
}

export async function handleInbound(ev: EngineInboundEvent, deps: EngineDeps = {}): Promise<EngineReply> {
  const d: Required<EngineDeps> = {
    llm: deps.llm ?? defaultLLM(),
    now: deps.now ?? (() => new Date()),
    getOrdersConnector: deps.getOrdersConnector ?? defaultGetOrdersConnector,
    notifyHandoff: deps.notifyHandoff ?? defaultNotifyHandoff,
  };
  const tenantId = ev.tenantId;
  const text = String(ev.text ?? "").slice(0, MAX_INBOUND_CHARS);
  const conv = getOrCreateConversation(tenantId, ev.channel, ev.externalId, ev.customerName ?? "");

  // 1. Dedupe + persist inbound
  if (ev.providerMessageId && hasProviderMessage(tenantId, conv.id, ev.providerMessageId)) {
    return { text: "", escalated: false, reason: "duplicate" };
  }
  // PII: the stored body has emails masked (j***@gmail.com); the order flow below still parses the original `text`.
  const parsedMedia = parseMediaText(text);
  const media = ev.media ? { kind: ev.media, caption: parsedMedia?.caption ?? "" } : parsedMedia;
  addMessage(tenantId, conv.id, {
    direction: "in", sender: "customer", body: maskEmailsInText(text),
    meta: clean({ providerMessageId: ev.providerMessageId, media: media?.kind }),
  });

  const settings = getAgentSettings(tenantId);
  if (conv.status === "needs_human" || conv.status === "human") return { text: "", escalated: false };
  if (!settings.botEnabled) {
    // Put it in the human queue once so nobody is left unanswered; the bot stays silent.
    setConversationStatus(tenantId, conv.id, "needs_human", "bot_disabled");
    await safeNotify(d, tenantId, conv.id, "bot_disabled");
    return { text: "", escalated: false };
  }
  if (conv.status === "resolved") setConversationStatus(tenantId, conv.id, "bot");

  const state = { ...(conv.state as EngineState) };
  if (conv.status === "resolved") { state.misses = 0; state.botTurns = 0; delete state.offer; state.capOffered = false; }
  // Media placeholders ("[Foto] ...") carry no language signal of their own: detect on the caption only.
  const langText = media ? media.caption : text;
  const lang = langText ? detectLanguage(langText, state.lang ?? settings.languageDefault ?? "es") : (state.lang ?? settings.languageDefault ?? "es");
  state.lang = lang;
  const ctx: Ctx = { tenantId, conv, settings, tone: T.clampTone(settings.toneLevel), lang, state, text, now: d.now(), deps: d, media };

  // Per-conversation inbound throttle (caps LLM cost / queue flooding): one calm message, then silence.
  try {
    const nowMs = ctx.now.getTime();
    const recent = recordInbound(tenantId, conv.id, nowMs);
    if (recent > MAX_INBOUND_PER_WINDOW) {
      if (state.throttledAt && nowMs - state.throttledAt < INBOUND_WINDOW_MS) return { text: "", escalated: false, reason: "throttled" };
      state.throttledAt = nowMs;
      const body = C.throttled(lang, ctx.tone);
      setConversationState(tenantId, conv.id, state as Record<string, unknown>);
      addMessage(tenantId, conv.id, { direction: "out", sender: "bot", body, meta: { intent: "throttled", lang, escalated: false } });
      return { text: body, escalated: false, reason: "throttled" };
    }
  } catch (e) {
    console.error("[engine] throttle check failed:", e instanceof Error ? e.message : "error");
  }

  try {
    return await pipeline(ctx);
  } catch (e) {
    console.error("[engine] pipeline error:", e instanceof Error ? e.message : "error");
    return escalate(ctx, "no_answer", "no_answer", { intent: "engine_error" });
  }
}

async function pipeline(ctx: Ctx): Promise<EngineReply> {
  const { text, state } = ctx;
  const injection = looksLikeInjection(text);

  // Non-text message (photo, voice note, sticker, location, file): never goes to retrieval or the LLM.
  // A caption with a safety/legal signal keeps that (urgent) reason; otherwise a person reviews the attachment.
  if (ctx.media) {
    const capEsc = ctx.media.caption ? detectEscalation(ctx.media.caption) : null;
    if (capEsc === "safety" || capEsc === "legal") return escalate(ctx, capEsc, capEsc, { intent: `escalation_${capEsc}`, media: ctx.media.kind });
    return escalate(ctx, "human_request", "human_request", { intent: "attachment", media: ctx.media.kind }, {
      intro: attachmentReceived(ctx.lang, ctx.tone, ctx.media.kind),
    });
  }

  // 2. Deterministic escalation rules, before any LLM.
  const esc = detectEscalation(text);
  if (esc) return escalate(ctx, esc, esc, { intent: `escalation_${esc}` });

  // Refund / cancellation / address change: read-only assistant, a person handles it.
  if (detectActionRequest(text)) {
    return escalate(ctx, "human_request", "human_request", { intent: "action_request" }, { intro: C.actionRequestIntro(ctx.lang, ctx.tone) });
  }

  // Pending offer ("¿quieres que te comunique con una persona?")
  if (state.offer) {
    const offer = state.offer;
    delete state.offer;
    if (isAffirmative(text)) return escalate(ctx, offer.reason, offer.kind ?? offer.reason, { intent: "offer_accepted" });
    if (isNegative(text) && text.trim().split(/\s+/).length <= 3) return finish(ctx, T.offerDeclined(ctx.lang, ctx.tone), { intent: "offer_declined" });
  }

  // Greeting-only message
  if (isGreetingOnly(text)) {
    const custom = customText(ctx.settings.greeting, "greeting");
    const g = custom && ctx.lang === ctx.settings.languageDefault ? custom : T.greeting(ctx.lang, ctx.tone, ctx.settings.agentName);
    return finish(ctx, g, { intent: "greeting" }, { noHello: true });
  }

  // 3. Order status flow (templates only; email never reaches the LLM)
  const flow = await runOrderFlow({
    tenantId: ctx.tenantId, text, lang: ctx.lang, tone: ctx.tone, state: state.order ?? {},
    connector: ctx.deps.getOrdersConnector(ctx.tenantId), noConnectorTold: !!state.noConnectorTold,
    limiter: lookupLimiter(ctx),
  });
  state.order = flow.state;
  if (flow.kind === "escalate") return escalate(ctx, flow.reason, flow.handoff, { intent: flow.intent });
  if (flow.kind === "offer") {
    if (flow.intent === "order_no_connector") state.noConnectorTold = true;
    state.offer = flow.offerKind ? { reason: flow.offerReason, kind: flow.offerKind } : { reason: flow.offerReason };
    return finish(ctx, flow.text, { intent: flow.intent, ...(flow.meta ?? {}) });
  }
  if (flow.kind === "reply") {
    let reply = flow.text;
    let crossSellSent = false;
    if (flow.resolved) {
      const cs = crossSellFor(ctx, "order_status", []);
      if (cs) { reply += `\n\n${cs}`; crossSellSent = true; }
    }
    return finish(ctx, reply, { intent: flow.intent, crossSell: crossSellSent || undefined });
  }

  // 4. Knowledge answer (RAG-lite)
  return knowledgeAnswer(ctx, injection);
}

/** DB-backed cross-conversation limiter bound to this tenant and clock. Fails open on DB errors (logged). */
function lookupLimiter(ctx: Ctx): LookupLimiter {
  const now = () => ctx.now.getTime();
  return {
    isBlocked: (n, e) => {
      try { return isLookupBlocked(ctx.tenantId, n, e, now()); }
      catch (err) { console.error("[engine] limiter check failed:", err instanceof Error ? err.message : "error"); return false; }
    },
    recordFailure: (n, e) => {
      try { recordLookupFailure(ctx.tenantId, n, e, now()); }
      catch (err) { console.error("[engine] limiter record failed:", err instanceof Error ? err.message : "error"); }
    },
  };
}

const ALWAYS_ON = ALWAYS_ON_SECTIONS;

/** A Data source linked to several sections has one chunk copy per section: keep one so top-k is not all duplicates. */
function dedupeChunks<C extends { sourceId: string | null; text: string }>(chunks: C[]): C[] {
  const seen = new Set<string>();
  return chunks.filter((c) => {
    if (!c.sourceId) return true;
    const k = `${c.sourceId}\u0000${c.text}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

async function knowledgeAnswer(ctx: Ctx, injection: boolean): Promise<EngineReply> {
  const { tenantId, text, state } = ctx;
  const chunks = dedupeChunks(listChunks(tenantId));
  const exclude = (c: { sectionKey: string | null }) => !!c.sectionKey && ALWAYS_ON.has(c.sectionKey);
  let hits = retrieve(text, chunks, { k: 4, exclude });
  const history = recentMessages(tenantId, ctx.conv.id, 7).slice(0, -1); // without the current inbound
  if (!hits.length) {
    // Short follow-ups ("¿y cuánto tarda?") borrow context from the previous customer message.
    const prev = [...history].reverse().find((m) => m.sender === "customer")?.body;
    if (prev) hits = retrieve(`${prev} ${text}`, chunks, { k: 4, exclude });
  }

  if (!hits.length) {
    state.misses = (state.misses ?? 0) + 1;
    if (state.misses >= MAX_MISSES) return escalate(ctx, "no_answer", "no_answer", { intent: "no_answer", injection: injection || undefined });
    return finish(ctx, T.clarify(ctx.lang, ctx.tone), { intent: "clarify", injection: injection || undefined });
  }

  // Always-on rules: file text when "Usar un archivo" is on (typed text if the file failed) + linked sources, capped.
  const sec = (k: "dos_donts" | "escalation") => getEffectiveSectionContent(tenantId, k).text;
  const sources = hits.map((h) => h.chunk);
  const system = buildSystemPrompt({
    agentName: ctx.settings.agentName, tone: ctx.tone, lang: ctx.lang,
    dosDonts: sec("dos_donts"), escalationRules: sec("escalation"), chunks: sources,
  });
  // History for the LLM: no order-flow bot replies (status, carrier, tracking), and
  // emails (raw or masked), phones and order/tracking-like numbers stripped from the rest.
  const hist = history
    .filter((m) => !(m.sender !== "customer" && (m.intent ?? "").startsWith("order_")))
    .slice(-4)
    .map((m) => ({ role: (m.sender === "customer" ? "customer" : "assistant") as "customer" | "assistant", text: redactForLLM(m.body).slice(0, 400) }));
  const question = redactPII(text);
  const user = buildUserMessage(question, hist);
  const raw = await ctx.deps.llm({ system, user, question, sources, lang: ctx.lang });
  const meta = { sources: sources.map((c) => c.id), injection: injection || undefined };

  if (!raw || raw.includes(HANDOFF_TOKEN)) return escalate(ctx, "no_answer", "no_answer", { intent: "llm_handoff", ...meta });

  const v = validateReply(raw, { sources: sources.map((c) => `${c.title}\n${c.text}`) });
  if (!v.ok) return escalate(ctx, "no_answer", "blocked", { intent: "blocked", blocked: v.violations, ...meta });

  state.misses = 0;
  const intent = isProductChunk(sources[0]) ? "product_question" : "knowledge";
  let reply = v.text;
  let crossSellSent = false;
  if (intent === "product_question") {
    const cs = crossSellFor(ctx, intent, hits);
    if (cs) { reply += `\n\n${cs}`; crossSellSent = true; }
  }
  return finish(ctx, reply, { intent, crossSell: crossSellSent || undefined, ...meta });
}

// ---------------- cross-sell ----------------
function crossSellFor(ctx: Ctx, intent: "order_status" | "product_question", hits: Retrieved[]): string | null {
  const level = ctx.settings.crossSellLevel;
  if (!level || level <= 0 || ctx.state.crossSellSent || isComplaint(ctx.text)) return null;
  let candidates: Retrieved[];
  if (intent === "product_question") {
    const main = hits[0]?.chunk;
    candidates = hits.slice(1).filter((h) => isProductChunk(h.chunk) && h.chunk.id !== main?.id && (h.chunk.title || "") !== (main?.title || ""));
  } else {
    // After an order status: retrieve product chunks related to what the customer talked about (redacted).
    const recent = recentMessages(ctx.tenantId, ctx.conv.id, 10).filter((m) => m.sender === "customer").map((m) => redactPII(m.body)).join(" ");
    candidates = retrieve(recent, listChunks(ctx.tenantId).filter(isProductChunk), { k: 1, minCoverage: 0.1 });
  }
  const pick = candidates[0]?.chunk;
  if (!pick) return null;
  const item = (pick.title?.trim() || pick.text.split(/(?<=[.!?])\s+|\n/)[0] || "").trim().replace(/[.:;]+$/, "").slice(0, 80);
  if (!item) return null;
  ctx.state.crossSellSent = true;
  return T.crossSell(ctx.lang, ctx.tone, level as 1 | 2 | 3, item);
}

// ---------------- reply / escalation ----------------
async function finish(ctx: Ctx, body: string, meta: Record<string, unknown>, opts: { noHello?: boolean } = {}): Promise<EngineReply> {
  const { state } = ctx;
  let text = body;
  if (!state.greeted && !opts.noHello) {
    const custom = customText(ctx.settings.greeting, "greeting");
    const hello = custom && ctx.lang === ctx.settings.languageDefault
      ? (custom.split(/(?<=[.!])\s+/)[0] ?? custom)
      : T.shortHello(ctx.lang, ctx.tone, ctx.settings.agentName);
    text = `${hello} ${text}`;
  }
  state.greeted = true;
  state.botTurns = (state.botTurns ?? 0) + 1;
  if (state.botTurns >= MAX_BOT_TURNS && !state.capOffered && !state.offer) {
    text += `\n\n${T.capOffer(ctx.lang, ctx.tone)}`;
    state.capOffered = true;
    state.offer = { reason: "human_request" };
    meta = { ...meta, capOffered: true };
  }
  setConversationState(ctx.tenantId, ctx.conv.id, state as Record<string, unknown>);
  addMessage(ctx.tenantId, ctx.conv.id, { direction: "out", sender: "bot", body: text, meta: clean({ ...meta, lang: ctx.lang, escalated: false }) });
  return { text, escalated: false };
}

async function escalate(
  ctx: Ctx, reason: EscalationReason, kind: T.HandoffKind, meta: Record<string, unknown>, opts: { intro?: string } = {},
): Promise<EngineReply> {
  const { state } = ctx;
  const bh = parseBusinessHours(ctx.settings.businessHours);
  const open = isOpenNow(bh, ctx.now);
  const intro = opts.intro ?? T.handoffIntro(kind, ctx.lang, ctx.tone, ctx.lang === ctx.settings.languageDefault ? customText(ctx.settings.fallbackMessage, "fallback") : "");
  const hours = formatBusinessHours(bh, ctx.lang);
  // Safety/legal are flagged urgent: never just "we will answer when we open".
  const when = reason === "safety" || reason === "legal"
    ? C.urgentWhen(ctx.lang, ctx.tone, open, hours)
    : T.handoffWhen(ctx.lang, ctx.tone, open, hours);
  const text = `${intro} ${when}`;
  delete state.offer;
  state.misses = 0; // a later "return to bot" starts with a fresh clarify turn (QA FINDING-C)
  state.greeted = true;
  state.botTurns = (state.botTurns ?? 0) + 1;
  if (state.order) { delete state.order.email; delete state.order.stage; }
  setConversationState(ctx.tenantId, ctx.conv.id, state as Record<string, unknown>);
  setConversationStatus(ctx.tenantId, ctx.conv.id, "needs_human", reason);
  addMessage(ctx.tenantId, ctx.conv.id, {
    direction: "out", sender: "bot", body: text,
    meta: clean({ ...meta, lang: ctx.lang, escalated: true, escalationReason: reason, outsideHours: open === false || undefined }),
  });
  await safeNotify(ctx.deps, ctx.tenantId, ctx.conv.id, reason);
  return { text, escalated: true, reason };
}

async function safeNotify(d: Required<EngineDeps>, tenantId: string, conversationId: string, reason: string) {
  try { await d.notifyHandoff(tenantId, conversationId, reason); }
  catch (e) { console.error("[engine] notifyHandoff failed:", e instanceof Error ? e.message : "error"); }
}

/** Owner-written greeting/fallback; "" (use the tone-aware template) when empty or a legacy default saved by old versions. */
function customText(v: string | undefined | null, kind: "greeting" | "fallback"): string {
  const t = (v ?? "").trim();
  return t && !isLegacyDefault(t, kind) ? t : "";
}

const clean = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));
