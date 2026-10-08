// Deterministic escalation rules (run BEFORE any LLM) + business-hours helpers.
import { fold } from "./text";

export type EscalationReason = "safety" | "legal" | "human_request" | "no_answer" | "attempts" | "bot_disabled";

// Food words: "se me quemó el pollo" / "I burnt the toast" is cooking, not a safety hazard.
const FOOD = "(?:el |la |los |las |mi |mis |un |una |unos |unas )?(?:pollo|comida|carne|arroz|pan|papas|cena|desayuno|almuerzo|pizza|galletas?|pastel|tortillas?|huevos?|frijoles|verduras|alitas|nuggets|pescado|filete|bistec|tocino|hamburguesas?|botana|guisado|sopa|salsa|cafe|palomitas|quesadillas?|tacos?|empanadas?|camarones|chuleta|costillas|res|cerdo)\\b";
const FOOD_EN = "(?:the |my |a |some )?(?:chicken|food|toast|fries|rice|bread|meat|bacon|pizza|dinner|lunch|breakfast|cookies?|cake|steak|fish|eggs?|wings|popcorn|potatoes)\\b";

// All patterns run on folded text (lowercase, no accents), so "se quemó" == "se quemo".
const SAFETY: RegExp[] = [
  /\bhumo\b/, /\bhumea\w*/, /\bsaca(ba)? humo\b/, /\bincendi\w*/, /\bfuego\b/, /\b(salen|salieron|saco|echa|echo|en) llamas\b/,
  new RegExp(`\\bse (?:me |le |nos |te |les )?(?:quemo|quemaron|esta quemando|incendio|derritio)\\b(?! ${FOOD})`),
  /\bme queme\b/, /\bquemadura\w*/, /\bolor a quemado\b/,
  /\bchispa\w*/, /\bchispea\w*/, /\bchisporrote\w*/,
  /\b(me|le|nos|te) (dio|dieron|da|dan) (una |un )?(descarga|toque|toques|choque)\b/, /\bdescargas? electrica\w*/, /\btoques? electric\w*/, /\bda toques\b/,
  /\bcorto ?circuito\b/, /\bexploto\b/, /\bexplosion\w*/, /\bestallo\b/, /\brevento\b/,
  /\bpeligro\w*/, /\blesion\w*/, /\b(me|se|nos|le|te) lastim\w*/, /\blastimad[oa]s?\b/, /\bherid[oa]s?\b/, /\bintoxic\w*/,
  /\bsmok(e|ing|ed)\b/, /\bfire\b/, /\bflames?\b/, new RegExp(`\\bburn(?:s|ed|t|ing)?\\b(?! ${FOOD_EN})`), /\bsparks?\b/, /\bspark(ed|ing)\b/,
  /\b(electric(al)? )?shock(ed)?\b/, /\belectrocut\w*/, /\bexplod\w*/, /\bexplosion\b/, /\binjur\w*/, /\bhurt\b/, /\bmelt(ed|ing)\b/, /\bdanger\w*/,
];

const LEGAL: RegExp[] = [
  /\bdemand(a|as|ar|are|aremos|o|ando)\b/, /\babogad[oa]s?\b/, /\bprofeco\b/, /\bdenunci\w*/, /\bfraude\w*/, /\bestafa\w*/,
  /\bacciones? legal\w*/, /\bproceso legal\b/, /\bcondusef\b/,
  /\blegal action\b/, /\blawyers?\b/, /\bsu(e|ing|ed)\b/, /\battorneys?\b/, /\blawsuit\w*/, /\bfraud\w*/, /\bscam\w*/,
];

const HUMAN: RegExp[] = [
  /\b(hablar|comunicar(me)?|contactar(me)?|platicar|chatear|atender(me)?|pasar(me)?|pasame|comunicame|conectame|conectar(me)?) (con )?(una |un |alguna |algun |alguien|el |la )?(persona|humano|agente|asesor|asesora|ejecutiv[oa]|representante|operador[a]?|alguien|gente|encargad[oa]|supervisor[a]?|gerente)\b/,
  /\b(quiero|necesito|exijo|prefiero|dame|deme|quisiera) (a )?(una |un )?(persona|humano|agente|asesor|asesora|ejecutiv[oa]|representante|operador[a]?|supervisor[a]?)\b/,
  /\b(persona|humano|agente|asesor) real\b/, /\boperador[a]?\b/, /\batencion (humana|personalizada)\b/, /\bno (eres|es) (un )?(robot|bot)\b.*\b(persona|humano)\b/,
  /\b(talk|speak|chat) (to|with) (a |an |the |some )?(real )?(human|person|agent|representative|rep|someone|somebody|manager|supervisor)\b/,
  /\bhuman\b/, /\bagent\b/, /\brepresentative\b/, /\boperator\b/, /\breal person\b/, /\blive (agent|person|support|chat)\b/,
];

// A safety word preceded (within 3 words, same clause) by a negation does not count: "no echa humo", "sin humo".
const NEGATION = /\b(no|sin|nunca|ni|jamas|tampoco|not|without|never|no longer|doesn'?t|didn'?t|isn'?t|wasn'?t|won'?t|hasn'?t|haven'?t)\b/;

function negated(t: string, index: number): boolean {
  const before = t.slice(0, index);
  const clause = before.split(/[.,;:!?¡¿\n]/).pop() ?? "";
  const words = clause.trim().split(/\s+/).filter(Boolean).slice(-3).join(" ");
  return NEGATION.test(words);
}

/** True when at least one safety pattern matches without being negated. */
function hasSafetySignal(t: string): boolean {
  for (const r of SAFETY) {
    const g = new RegExp(r.source, "g");
    for (const m of t.matchAll(g)) {
      if (!negated(t, m.index ?? 0)) return true;
    }
  }
  return false;
}

/** Pure: which escalation class (if any) the customer text triggers. Priority: safety > legal > human_request. */
export function detectEscalation(text: string): Exclude<EscalationReason, "no_answer" | "attempts" | "bot_disabled"> | null {
  const t = fold(text);
  if (hasSafetySignal(t)) return "safety";
  if (LEGAL.some((r) => r.test(t))) return "legal";
  if (HUMAN.some((r) => r.test(t))) return "human_request";
  return null;
}

// Actions the read-only assistant cannot do: refunds, cancellations, address changes. Always a person.
const ACTION: RegExp[] = [
  /\breembols\w*/, /\b(devolver|devuelvan|regresar|regresen|reintegr\w*) (me |mi |el |todo el )*dinero\b/, /\bmi dinero de vuelta\b/,
  /\bcancel(ar|o|en|e|a|ame|enme)? (mi |el |la |una |un |este |esta )?(pedido|compra|orden)\b/,
  /\bcambi(ar|o|en|e)( de)? (la |mi )?direccion\b/, /\bcambio de direccion\b/, /\b(corregir|modificar|actualizar) (la |mi )?direccion\b/,
  /\brefund\w*/, /\bmoney back\b/, /\bcancel (my |the |this )?(order|purchase)\b/,
  /\bchange (my |the )?(shipping |delivery )?address\b/, /\bupdate (my |the )?(shipping |delivery )?address\b/,
];
// "¿Cuál es la política de reembolsos?" is a knowledge question, not a request.
const POLICY_QUESTION = /\b(politica|politicas|policy|policies|como funciona\w*|how (do|does) (the )?\w+ work)\b/;

/** Pure: does the customer ask for a refund / cancellation / address change (which only a person can do)? */
export function detectActionRequest(text: string): boolean {
  const t = fold(text);
  if (POLICY_QUESTION.test(t)) return false;
  return ACTION.some((r) => r.test(t));
}

// ---------------- business hours ----------------
// Accepted JSON shapes (the settings module owns the shape; we are tolerant):
//  { "timezone": "America/Mexico_City", "text": "Lun a Vie 9 a 18 h",
//    "days": { "mon": [{"open":"09:00","close":"18:00"}] | {"open":"09:00","close":"18:00"} | "09:00-18:00" | null, ... } }
//  or the same day keys at the top level. Day keys: mon..sun, also lun/mar/mie/jue/vie/sab/dom or 0-6 (0 = Sunday).
type Range = { open: number; close: number }; // minutes since midnight
export interface BusinessHours { timezone: string; text?: string; days: Record<number, Range[]>; configured: boolean }

const DAY_KEYS: Record<string, number> = {
  sun: 0, sunday: 0, dom: 0, domingo: 0, mon: 1, monday: 1, lun: 1, lunes: 1, tue: 2, tuesday: 2, mar: 2, martes: 2,
  wed: 3, wednesday: 3, mie: 3, miercoles: 3, thu: 4, thursday: 4, jue: 4, jueves: 4, fri: 5, friday: 5, vie: 5, viernes: 5,
  sat: 6, saturday: 6, sab: 6, sabado: 6, "0": 0, "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 6,
};
const toMin = (s: unknown): number | null => {
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(String(s ?? "").trim());
  if (!m) return null;
  const h = Number(m[1]), mi = Number(m[2] ?? 0);
  return h <= 24 && mi < 60 ? h * 60 + mi : null;
};
const DAY_MIN = 24 * 60;
/**
 * open < close: same-day range. close <= open: overnight, the range runs past midnight into the next day
 * (20:00-02:00 -> close 26:00; 09:00-00:00 -> close 24:00). open == close (other than 00:00-24:00) is ignored.
 */
function mkRange(o: number | null, c: number | null): Range[] {
  if (o == null || c == null || o >= DAY_MIN) return [];
  if (c > o) return [{ open: o, close: c }];
  if (c === o) return [];
  return [{ open: o, close: c + DAY_MIN }];
}
function parseRanges(v: unknown): Range[] {
  if (v == null || v === false) return [];
  if (Array.isArray(v)) return v.flatMap(parseRanges);
  if (typeof v === "string") {
    const m = /^\s*(\d{1,2}(?::\d{2})?)\s*-\s*(\d{1,2}(?::\d{2})?)\s*$/.exec(v);
    if (!m) return [];
    return mkRange(toMin(m[1]), toMin(m[2]));
  }
  if (typeof v === "object") {
    const r = v as Record<string, unknown>;
    if (r.closed === true || r.enabled === false) return [];
    return mkRange(toMin(r.open ?? r.from ?? r.start), toMin(r.close ?? r.to ?? r.end));
  }
  return [];
}

export function parseBusinessHours(json: string | undefined | null): BusinessHours {
  let raw: Record<string, unknown> = {};
  try { const p = JSON.parse(json || "{}"); if (p && typeof p === "object" && !Array.isArray(p)) raw = p; } catch { /* ignore */ }
  const tz = typeof raw.timezone === "string" && raw.timezone ? raw.timezone : typeof raw.tz === "string" ? raw.tz : "America/Mexico_City";
  const text = typeof raw.text === "string" && raw.text.trim() ? raw.text.trim() : undefined;
  const src = (raw.days && typeof raw.days === "object" ? raw.days : raw) as Record<string, unknown>;
  const days: Record<number, Range[]> = {};
  for (const [k, v] of Object.entries(src)) {
    const d = DAY_KEYS[fold(k)];
    if (d === undefined) continue;
    days[d] = [...(days[d] ?? []), ...parseRanges(v)];
  }
  const configured = Object.values(days).some((r) => r.length > 0);
  let validTz = tz;
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); } catch { validTz = "America/Mexico_City"; }
  return { timezone: validTz, text, days, configured };
}

/** Is the business open at `now`? null when no hours are configured. */
export function isOpenNow(bh: BusinessHours, now: Date): boolean | null {
  if (!bh.configured) return null;
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: bh.timezone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const day = DAY_KEYS[get("weekday").toLowerCase()] ?? 0;
  const mins = Number(get("hour")) * 60 + Number(get("minute"));
  if ((bh.days[day] ?? []).some((r) => mins >= r.open && mins < Math.min(r.close, DAY_MIN))) return true;
  // overnight ranges that started yesterday spill into today
  const prev = (day + 6) % 7;
  return (bh.days[prev] ?? []).some((r) => r.close > DAY_MIN && mins < r.close - DAY_MIN);
}

const DAY_NAMES = { es: ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"], en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] };
// An overnight close (> 24:00) is shown as the next-day clock time: 20:00–2:00. A midnight close stays "24:00".
const fmt = (m: number) => { const x = m > DAY_MIN ? m - DAY_MIN : m; return `${Math.floor(x / 60)}:${String(x % 60).padStart(2, "0")}`; };

/** Human summary like "lun–vie 9:00–18:00, sáb 10:00–14:00". Uses `text` when provided. */
export function formatBusinessHours(bh: BusinessHours, lang: "es" | "en"): string | null {
  if (bh.text) return bh.text;
  if (!bh.configured) return null;
  const order = [1, 2, 3, 4, 5, 6, 0];
  const sig = (d: number) => (bh.days[d] ?? []).map((r) => `${fmt(r.open)}–${fmt(r.close)}`).join(", ");
  const groups: { from: number; to: number; s: string }[] = [];
  for (const d of order) {
    const s = sig(d);
    const last = groups[groups.length - 1];
    if (last && last.s === s && order.indexOf(d) === order.indexOf(last.to) + 1) last.to = d;
    else groups.push({ from: d, to: d, s });
  }
  const names = DAY_NAMES[lang];
  return groups.filter((g) => g.s).map((g) => `${names[g.from]}${g.from !== g.to ? "–" + names[g.to] : ""} ${g.s}`).join(", ");
}
