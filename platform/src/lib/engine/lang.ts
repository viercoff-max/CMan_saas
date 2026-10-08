// Language detection: Spanish (Mexico) by default, English only when the text is clearly English.
import { fold } from "./text";

export type Lang = "es" | "en";

const EN = new Set([
  "the", "my", "is", "are", "was", "where", "what", "how", "when", "why", "which", "who", "hello", "hi", "hey", "please",
  "thanks", "thank", "you", "your", "i", "i'm", "im", "it", "it's", "does", "do", "don't", "doesn't", "can", "could", "would",
  "want", "need", "with", "and", "have", "has", "this", "that", "order", "of", "to", "for", "in", "on", "get", "will",
  "speak", "talk", "someone", "human", "person", "warranty", "shipping", "return", "refund", "yes", "not", "be", "an",
  "there", "here", "check", "from", "got", "caught", "started", "stopped", "broken", "broke", "fire", "smoke", "air", "fryer",
  "kettle", "oven", "maker", "working", "work", "just", "again", "all", "out", "up", "about", "at", "by", "or", "but", "very",
  "also", "did", "had", "our", "we", "they", "she", "his", "her", "us", "them", "sorry", "much", "many", "long", "know",
  "should", "into", "after", "before", "bought", "buy", "received", "package", "arrive", "arrived", "still", "yet", "any", "status", "tracking", "number", "email", "help", "good", "morning", "afternoon", "evening",
]);
const ES = new Set([
  "el", "la", "los", "las", "de", "del", "que", "mi", "mis", "es", "son", "donde", "pedido", "hola", "por", "favor", "gracias",
  "como", "puedo", "quiero", "necesito", "con", "y", "tengo", "cuando", "esta", "este", "su", "sus", "para", "una", "un",
  "se", "lo", "le", "me", "te", "ya", "pero", "muy", "mas", "tiene", "tienen", "hay", "orden", "garantia", "envio",
  "buenas", "buenos", "dias", "tardes", "noches", "si", "cual", "cuanto", "cuanta", "hacer", "estoy", "usted", "ustedes",
  "persona", "hablar", "numero", "correo", "ayuda", "bien", "al", "en", "o", "aqui", "llega", "llego", "porque", "pero",
]);

/**
 * Returns "en" only when the text is clearly English; ties and ambiguous/short texts keep `previous`
 * (the conversation's current language) which itself defaults to Spanish.
 */
export function detectLanguage(text: string, previous: Lang = "es"): Lang {
  const raw = text.toLowerCase();
  let es = 0, en = 0;
  if (/[ñáéíóú¿¡]/.test(raw)) es += 2;
  const words = fold(text).replace(EMAIL_LIKE, " ").split(/[^a-z']+/).filter(Boolean);
  for (const w of words) {
    if (ES.has(w)) es++;
    if (EN.has(w)) en++;
  }
  // Words present in both lists (e.g. "a", "no") are not in both sets, so no double counting needed.
  if (en >= 2 && en > es) return "en";
  if (en === 1 && es === 0 && words.length <= 2 && /^(hi|hello|hey|thanks|thank|please|yes|help)$/.test(words[0] ?? "")) return "en";
  if (es >= 1 && es > en) return "es";
  return previous;
}
const EMAIL_LIKE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/g;
