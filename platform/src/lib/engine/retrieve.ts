// RAG-lite: keyword retrieval (BM25) over the tenant's chunks. No embeddings needed locally.
import type { Chunk } from "../types";
import { fold } from "./text";

const STOP = new Set((
  // es
  "a al algo algun alguna algunas alguno algunos ante antes aqui asi aun cada como con contra cual cuales cuando de del desde donde dos e el ella ellas ello ellos " +
  "en entre era eran es esa esas ese eso esos esta estaba estado estan estar estas este esto estos estoy fue fueron ha habia han hasta hay he la las le les lo los " +
  "mas me mi mis mucho muy nada ni no nos nosotros o os otra otro para pero poco por porque puede pueden puedo que quien se sea ser si sido sin sobre son su sus " +
  "tambien tan te tener tengo tiene tienen todo todos tu tus u un una uno unos usted ustedes y ya yo hola gracias favor quiero quisiera necesito saber " +
  "buenas buenos dias tardes noches oye disculpa pregunta duda informacion info hacer hace cuanto cuanta cuantos cuantas mucha muchas ustedes vez " +
  // en
  "a about an and are as at be been but by can could do does did for from had has have hello hi how i if in into is it its me my no not of on or our please " +
  "should so than thanks thank that the their them then there these they this to too us was we were what when where which who why will with would you your " +
  "want need know tell question info information hey any some"
).split(/\s+/));

// Small bilingual canonical map so English questions can match Spanish content (and vice versa).
const CANON: Record<string, string> = {
  warranty: "garantia", guarantee: "garantia", ship: "envio", shipping: "envio", shipment: "envio", delivery: "envio", deliver: "envio", entrega: "envio", envia: "envio",
  return: "devolucion", refund: "reembolso", exchange: "cambio", devolv: "devolucion", devuelv: "devolucion", devolver: "devolucion",
  price: "precio", cost: "precio", costo: "precio", cuesta: "precio",
  clean: "limpi", cleaning: "limpi", limpia: "limpi", limpio: "limpi", limpiar: "limpi", limpieza: "limpi",
  manual: "manual", instruction: "instruccion", instructions: "instruccion",
  fryer: "freidora", airfryer: "freidora", "air-fryer": "freidora", kettle: "hervidor", coffee: "cafe", cafetera: "cafe", toaster: "tostador", tostadora: "tostador",
  blender: "licuadora", oven: "horno", pressure: "presion", cooker: "olla",
  hours: "horario", schedule: "horario", open: "horario", store: "tienda", payment: "pago", pay: "pago", pagar: "pago",
  invoice: "factura", facturar: "factura", billing: "factura", temperature: "temperatura", basket: "canasta", canastilla: "canasta",
  dishwasher: "lavavajilla", lavavajillas: "lavavajilla", replacement: "refaccion", part: "refaccion", parts: "refaccion", repuesto: "refaccion",
};

/** Light stemming for es/en (plural and very common suffixes only; good enough for keyword matching). */
export function stem(w: string): string {
  if (CANON[w]) return CANON[w];
  let s = w;
  if (s.length > 5 && s.endsWith("mente")) s = s.slice(0, -5);
  else if (s.length > 5 && s.endsWith("ing")) s = s.slice(0, -3);
  else if (s.length > 4 && s.endsWith("ed")) s = s.slice(0, -2);
  if (s.length > 4 && s.endsWith("ciones")) s = s.slice(0, -2);
  else if (s.length > 4 && /(es)$/.test(s) && /[lrndzj]es$/.test(s)) s = s.slice(0, -2);
  else if (s.length > 3 && s.endsWith("s") && !s.endsWith("ss")) s = s.slice(0, -1);
  return CANON[s] ?? s;
}

export function tokenize(text: string): string[] {
  return fold(text)
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g, " ")
    .split(/[^a-z0-9ñ]+/)
    .filter((w) => w.length >= 2 && !STOP.has(w))
    .map(stem)
    .filter((w) => w.length >= 2 && !STOP.has(w));
}

export interface Retrieved { chunk: Chunk; score: number; coverage: number }
export interface RetrieveOptions { k?: number; minScore?: number; minCoverage?: number; exclude?: (c: Chunk) => boolean }

/**
 * BM25 (k1=1.2, b=0.75) over title+text. A chunk is relevant when its BM25 score >= minScore AND it covers
 * enough of the distinct query terms (coverage guards against one generic word matching).
 */
export function retrieve(query: string, chunks: Chunk[], opts: RetrieveOptions = {}): Retrieved[] {
  const k = opts.k ?? 4, minScore = opts.minScore ?? 0.3;
  const pool = opts.exclude ? chunks.filter((c) => !opts.exclude!(c)) : chunks;
  const q = [...new Set(tokenize(query))];
  if (!q.length || !pool.length) return [];
  // Short questions must match most of their terms; long messages (often with noise) need fewer.
  const minCoverage = opts.minCoverage ?? (q.length <= 2 ? 0.5 : q.length <= 4 ? 0.25 : 0.14);
  const docs = pool.map((c) => {
    const toks = tokenize(`${c.title} ${c.title} ${c.text}`);
    const tf = new Map<string, number>();
    for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
    return { c, tf, len: toks.length };
  });
  const N = docs.length;
  const avg = docs.reduce((a, d) => a + d.len, 0) / N || 1;
  const df = new Map<string, number>();
  for (const t of q) df.set(t, docs.filter((d) => d.tf.has(t)).length);
  const out: Retrieved[] = [];
  for (const d of docs) {
    let score = 0, matched = 0;
    for (const t of q) {
      const f = d.tf.get(t) ?? 0;
      if (!f) continue;
      matched++;
      const n = df.get(t) ?? 0;
      // +1 inside log keeps idf positive; floor keeps tiny corpora (1-2 chunks) usable.
      const idf = Math.max(Math.log(1 + (N - n + 0.5) / (n + 0.5)), 0.25);
      score += idf * ((f * 2.2) / (f + 1.2 * (0.25 + 0.75 * (d.len / avg))));
    }
    const coverage = matched / q.length;
    if (score >= minScore && coverage >= minCoverage) out.push({ chunk: d.c, score, coverage });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, k);
}

/** Chunks that describe products (used for cross-sell suggestions). */
export const isProductChunk = (c: Chunk) => c.sectionKey === "products" || /\b(producto|productos|product|products|catalogo|catalog)\b/.test(fold(c.title));
