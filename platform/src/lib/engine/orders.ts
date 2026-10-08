// Order-status flow: intent detection, extraction, masking and the per-conversation state machine.
// PRIVACY: the customer's email never goes to the LLM, logs, meta or replies (only masked if ever shown).
import type { OrdersConnector, OrderStatusResult } from "../types";
import { fold } from "./text";
import type { Lang } from "./lang";
import * as T from "./templates";
import * as C from "./copy";

export const MAX_ORDER_FAILURES = 3;

export interface OrderState {
  stage?: "ask_number" | "ask_email";
  number?: string;
  /** Held only between the two questions, deleted right after the lookup. */
  email?: string;
  failures?: number;
  locked?: boolean;
}

const ORDER_WORD = /\b(pedido|pedidos|orden|ordenes|order|orders|mi compra|mi paquete|mi envio|my package|my shipment|my purchase|my parcel)\b/;
const STATUS_WORD = /\b(donde|cuando|llega|llegara|llegado|llego|status|estatus|estado|seguimiento|enviad[oa]|en camino|sigue|va|rastre\w*|where|when|arriv\w*|shipped|ship|track\w*|delivered|deliver\w*|check|revisar|consultar|checar|saber)\b/;
const DIRECT = /\b(rastreo|rastrear|guia de (envio|rastreo)|numero de guia|tracking|track my|order status|where('?s| is) my|donde esta mi|no ha llegado|no me ha llegado|no me llega|no llega mi)\b/;

/** Pure: does the text ask about the status of an order? */
export function detectOrderIntent(text: string): boolean {
  const t = fold(text);
  if (DIRECT.test(t)) return true;
  if (ORDER_WORD.test(t) && STATUS_WORD.test(t)) return true;
  if (/^(mi )?(pedido|orden|order)\s*(#|no\.?|num(ero)?\.?)?\s*:?\s*[a-z0-9-]*\d/.test(t)) return true;
  return false;
}

/** Pure: extract a lowercase email from free text. */
export function extractEmail(text: string): string | null {
  const m = /[a-z0-9._%+-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}/i.exec(text);
  return m ? m[0].toLowerCase() : null;
}

const NUM_TOKEN = "([a-z]{0,6}-?\\d[a-z0-9-]{2,19})";
/**
 * Pure: extract an order number ("#1234", "pedido 1234", "orden No. MX-1234", "order #A1B2C3", bare "1234").
 * Returns the token without '#', uppercased. Requires at least one digit; ignores emails and phone-like 10+ digit runs.
 */
export function extractOrderNumber(text: string): string | null {
  const t = fold(text).replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g, " ");
  const clean = (s: string) => s.replace(/^-+|-+$/g, "").toUpperCase();
  const hash = new RegExp(`#\\s?${NUM_TOKEN}`).exec(t);
  if (hash) return clean(hash[1]);
  const kw = new RegExp(`\\b(?:pedido|orden|order|folio|compra|num(?:ero)?|number)\\b\\s*(?:de pedido|de orden|de compra)?\\s*(?:#|no\\.?|num(?:ero)?\\.?|number|es|is)?\\s*:?\\s*${NUM_TOKEN}\\b`).exec(t);
  if (kw && /\d/.test(kw[1])) return clean(kw[1]);
  // bare token: 3-12 digits, optionally with a short letter prefix (avoid 10+ digit phone numbers)
  for (const m of t.matchAll(/\b([a-z]{0,4}-?\d{3,12})\b/g)) {
    const digits = m[1].replace(/\D/g, "");
    if (digits.length >= 10 && !/[a-z]/.test(m[1])) continue;
    return clean(m[1]);
  }
  return null;
}

export { maskEmail } from "./text";

const EXIT_RE = /\b(cancela\w*|olvidalo|olvida|ya no|nada|never ?mind|forget it|cancel)\b/;

export type OrderOutcome =
  | { kind: "reply"; text: string; intent: string; state: OrderState; resolved?: boolean }
  | { kind: "escalate"; reason: "attempts" | "no_answer"; handoff: T.HandoffKind; intent: string; state: OrderState }
  | { kind: "offer"; text: string; intent: string; state: OrderState; offerReason: "no_answer" | "human_request"; offerKind?: T.HandoffKind; meta?: Record<string, unknown> }
  | { kind: "pass"; state: OrderState };

/** Cross-conversation limiter (see limiter.ts); optional so the flow stays testable without a DB. */
export interface LookupLimiter {
  isBlocked(orderNumber: string, email: string): boolean;
  recordFailure(orderNumber: string, email: string): void;
}

export interface OrderFlowInput {
  tenantId: string; text: string; lang: Lang; tone: T.Tone; state: OrderState;
  connector: OrdersConnector | null; noConnectorTold: boolean;
  limiter?: LookupLimiter;
}

/**
 * Connector results may carry `mayBeOutsideWindow` (shop cannot see orders older than 60 days). It depends only on
 * the shop's scopes, never on whether the order exists. Legacy `tooOld` is read the same way (never auto-escalates).
 */
type LookupResult = OrderStatusResult & { mayBeOutsideWindow?: boolean };

/**
 * The order state machine. Returns "pass" when the message is not part of an order flow
 * (the engine then continues with knowledge answers).
 */
export async function runOrderFlow(i: OrderFlowInput): Promise<OrderOutcome> {
  const st: OrderState = { ...i.state };
  const num = extractOrderNumber(i.text);
  const email = extractEmail(i.text);
  const intent = detectOrderIntent(i.text);
  const inFlow = !!st.stage;

  if (!inFlow && !intent && !(num && email)) return { kind: "pass", state: st };
  if (inFlow && !num && !email && !intent) {
    // Customer moved on (asked something else, or cancelled): leave the flow.
    const t = fold(i.text);
    if (EXIT_RE.test(t) || t.split(" ").length >= 3) { delete st.stage; delete st.number; delete st.email; return { kind: "pass", state: st }; }
  }

  if (st.locked) {
    delete st.stage; delete st.email;
    return { kind: "escalate", reason: "attempts", handoff: "attempts", intent: "order_locked", state: st };
  }

  if (!i.connector) {
    delete st.stage; delete st.number; delete st.email;
    if (i.noConnectorTold) return { kind: "escalate", reason: "no_answer", handoff: "no_answer", intent: "order_no_connector", state: st };
    return { kind: "offer", text: T.noConnector(i.lang, i.tone), intent: "order_no_connector", state: st, offerReason: "no_answer" };
  }

  if (num) st.number = num;
  if (email) st.email = email;
  if (!st.number) {
    st.stage = "ask_number";
    return { kind: "reply", text: st.email ? T.askNumberHaveEmail(i.lang, i.tone) : T.askOrderNumber(i.lang, i.tone), intent: "order_ask_number", state: st };
  }
  if (!st.email) {
    st.stage = "ask_email";
    return { kind: "reply", text: T.askEmail(i.lang, i.tone), intent: "order_ask_email", state: st };
  }

  const number = st.number, mail = st.email;
  delete st.stage; delete st.email; delete st.number;

  // Every failure (not found, email mismatch, missing email, limiter block) looks the same to the customer and
  // counts toward the per-conversation limit.
  const fail = (): OrderOutcome | null => {
    st.failures = (st.failures ?? 0) + 1;
    if (st.failures >= MAX_ORDER_FAILURES) {
      st.locked = true;
      return { kind: "escalate", reason: "attempts", handoff: "attempts", intent: "order_not_found", state: st };
    }
    return null;
  };

  // Cross-conversation limiter: too many recent failures for this order number, email or tenant => do not call the
  // connector; same generic text plus a human offer.
  if (i.limiter?.isBlocked(number, mail)) {
    const esc = fail();
    if (esc) return esc;
    return {
      kind: "offer", text: `${T.orderNotFound(i.lang, i.tone)} ${T.capOffer(i.lang, i.tone)}`, intent: "order_not_found",
      state: st, offerReason: "human_request", meta: { lookupLimited: true },
    };
  }

  let res: LookupResult;
  try {
    res = await i.connector.lookupOrderStatus(i.tenantId, number, mail);
  } catch {
    return { kind: "offer", text: T.orderLookupError(i.lang, i.tone), intent: "order_error", state: st, offerReason: "no_answer" };
  }
  if (res.found) {
    return {
      kind: "reply", intent: "order_status", state: st, resolved: true,
      text: T.orderFound(i.lang, i.tone, {
        orderNumber: number, statusText: res.statusText, carrier: res.carrier,
        trackingNumber: res.trackingNumber, trackingUrl: res.trackingUrl, estimatedDelivery: res.estimatedDelivery,
      }),
    };
  }
  i.limiter?.recordFailure(number, mail);
  const esc = fail();
  if (esc) return esc;
  if (res.mayBeOutsideWindow || res.tooOld) {
    // Shop-level flag (no read_all_orders), identical for every failure in this shop: offer, never auto-escalate.
    return {
      kind: "offer", text: `${T.orderNotFound(i.lang, i.tone)} ${C.olderOrderOffer(i.lang, i.tone)}`, intent: "order_not_found",
      state: st, offerReason: "no_answer", offerKind: "too_old",
    };
  }
  return { kind: "reply", text: T.orderNotFound(i.lang, i.tone), intent: "order_not_found", state: st };
}
