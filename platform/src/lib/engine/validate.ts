// Output validator: every LLM reply passes through here before reaching the customer.
import { capLength, fold } from "./text";

export const MAX_REPLY_CHARS = 700;
/** Canary embedded in the system prompt; if it ever shows up in a reply, the prompt leaked. */
export const PROMPT_CANARY = "GUARD-7F3A-INTERNAL";

export type Violation = "promo" | "url" | "action_claim" | "prompt_leak" | "empty" | "unsupported_fact";
export interface ValidationResult { ok: boolean; text: string; violations: Violation[]; details: string[] }

// Promo / discount vocabulary. Allowed only if the exact matched phrase appears in the retrieved sources.
const PROMO: RegExp[] = [
  /\bdescuentos?\b/g, /\bcupon(es)?\b/g, /\bcodigos?\b/g, /\d+\s*%/g, /\bgratis\b/g, /\bgratuit[oa]s?\b/g, /\bpromo\w*/g, /\brebajas?\b/g,
  /\brebajad[oa]s?\b/g, /\b\d\s*x\s*\d\b/g, /\bofertas?\b/g, /\bmeses sin intereses\b/g, /\bmsi\b/g,
  /\bdiscount\w*/g, /\bcoupons?\b/g, /\bcodes?\b/g, /(?<!feel )\bfree\b/g, /\b(on|for) sale\b/g, /\bsale price\b/g, /\bdeals?\b/g, /\bvouchers?\b/g,
];

const ACTION_CLAIMS: RegExp[] = [
  /\b(ya )?(he|hemos|se ha|se han|ya se|ya) (procesado|realizado|emitido|aplicado|cancelado|reembolsado|tramitado|generado|modificado|cambiado|actualizado)\b/,
  /\breembolso (fue |ha sido |ya esta |esta )?(realizado|procesado|aprobado|emitido|hecho|autorizado)\b/,
  /\b(ya (cancele|cancelamos|reembolse|reembolsamos|procese|procesamos))\b/,
  /\b(tu|su) (pedido|orden|compra) (ha sido|fue|ya fue|ya esta|esta) (cancelad[oa]|reembolsad[oa]|modificad[oa])\b/,
  /\b(he|hemos) (cambiado|actualizado|modificado) (tu|su|la) (direccion|pedido|orden)\b/,
  /\b(i|we)('ve| have)? (refunded|cancell?ed|processed|issued|changed|updated|modified)\b/,
  /\brefund (has been|was|is) (issued|processed|approved|completed|done)\b/,
  /\b(order|it|purchase) (has been|was) (cancell?ed|refunded|modified)\b/,
];

const LEAK: RegExp[] = [
  /system prompt/, /prompt del sistema/, /instrucciones internas/, /internal instructions/, /<\/?\s*(customer_message|sources|source|history)\b/,
  /\breglas estrictas\b/, /\bstrict rules\b/,
];

// Numeric facts (durations, prices): "5 años", "30 días", "24 meses", "$1,299", "499 pesos". The number + unit must also
// appear in the retrieved sources (QA FINDING-G): the LLM must not invent warranty lengths, delivery times or prices.
const WORD_NUM: Record<string, string> = {
  un: "1", uno: "1", una: "1", dos: "2", tres: "3", cuatro: "4", cinco: "5", seis: "6", siete: "7", ocho: "8", nueve: "9", diez: "10",
  once: "11", doce: "12", quince: "15", veinte: "20", treinta: "30", sesenta: "60", noventa: "90",
  a: "1", an: "1", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9", ten: "10",
  eleven: "11", twelve: "12", fifteen: "15", twenty: "20", thirty: "30", sixty: "60", ninety: "90",
};
const UNIT: [RegExp, string][] = [
  [/^(anos?|years?)$/, "year"], [/^(mes|meses|months?)$/, "month"], [/^(semanas?|weeks?)$/, "week"],
  [/^(dias?|days?)$/, "day"], [/^(horas?|hours?|hrs?)$/, "hour"], [/^(minutos?|minutes?|mins?)$/, "minute"],
  [/^(pesos?|mxn|usd|dolares|dollars?)$/, "money"],
];
const normNum = (n: string) => n.replace(/,/g, "").replace(/\.0+$/, "");
const FACT_RE = /(\$\s*(\d[\d,]*(?:\.\d+)?))|\b(\d[\d,]*(?:\.\d+)?|[a-z]+)\s+(anos?|years?|mes|meses|months?|semanas?|weeks?|dias?|days?|horas?|hours?|hrs?|minutos?|minutes?|mins?|pesos?|mxn|usd|dolares|dollars?)\b/g;
/** Set of "number|unitClass" facts in folded text. */
export function numericFacts(folded: string): Set<string> {
  const out = new Set<string>();
  for (const m of folded.matchAll(FACT_RE)) {
    if (m[2]) { out.add(`${normNum(m[2])}|money`); continue; }
    const raw = m[3];
    const num = /^\d/.test(raw) ? normNum(raw) : WORD_NUM[raw];
    if (!num) continue; // "algunos días", "pocos meses": no concrete number
    const unit = UNIT.find(([re]) => re.test(m[4]))?.[1];
    if (unit) out.add(`${num}|${unit}`);
  }
  return out;
}

const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()"']+/gi;
const normUrl = (u: string) => u.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/[.,;:!?)\]]+$/, "").replace(/\/+$/, "");

export interface ValidateOptions { sources: string[]; maxChars?: number }

/** Pure: check an LLM reply against the retrieved sources. */
export function validateReply(reply: string, opts: ValidateOptions): ValidationResult {
  const violations = new Set<Violation>();
  const details: string[] = [];
  let text = (reply ?? "").replace(/\[S\d+\]/g, "").replace(/[ \t]+\n/g, "\n").replace(/[ \t]{2,}/g, " ").trim();
  if (!text) violations.add("empty");

  const srcFold = fold(opts.sources.join("\n"));
  const r = fold(text);

  for (const re of PROMO) {
    for (const m of r.matchAll(re)) {
      const phrase = m[0].trim();
      if (!srcFold.includes(phrase)) { violations.add("promo"); details.push(`promo:${phrase}`); }
    }
  }

  const srcUrls = new Set<string>();
  for (const s of opts.sources) for (const m of s.matchAll(URL_RE)) srcUrls.add(normUrl(m[0]));
  for (const m of text.matchAll(URL_RE)) {
    const u = normUrl(m[0]);
    if (![...srcUrls].some((s) => s === u || s.startsWith(u + "/") || u === s.split("?")[0])) { violations.add("url"); details.push(`url:${u}`); }
  }
  // bare domains like "chefman-ofertas.com"
  for (const m of r.matchAll(/\b[a-z0-9-]+\.(com|mx|net|org|shop|store|io|co)(\.[a-z]{2})?\b/g)) {
    if (!srcFold.includes(m[0])) { violations.add("url"); details.push(`domain:${m[0]}`); }
  }

  const srcFacts = numericFacts(srcFold);
  for (const f of numericFacts(r)) {
    if (!srcFacts.has(f)) { violations.add("unsupported_fact"); details.push(`fact:${f}`); }
  }

  for (const re of ACTION_CLAIMS) {
    const m = re.exec(r);
    if (m && !srcFold.includes(m[0].trim())) { violations.add("action_claim"); details.push(`action:${m[0].trim()}`); }
  }
  if (text.includes(PROMPT_CANARY) || LEAK.some((re) => re.test(r))) { violations.add("prompt_leak"); details.push("prompt_leak"); }
  if (/\[HANDOFF\]/i.test(text)) text = text.replace(/\[HANDOFF\]/gi, "").trim();

  text = capLength(text, opts.maxChars ?? MAX_REPLY_CHARS);
  return { ok: violations.size === 0, text, violations: [...violations], details };
}
