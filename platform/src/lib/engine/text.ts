// Small text utilities shared by the engine (pure, no I/O).

/** Lowercase + strip accents/diacritics (á->a, ñ->n, ü->u) + collapse whitespace. */
export function fold(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

/** Pure: j***@gmail.com */
export function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!domain) return "***";
  return `${(user || "*").charAt(0)}***@${domain}`;
}

/** Masks every email in free text (used for STORED message bodies and outbox files). Idempotent. */
export function maskEmailsInText(text: string): string {
  return String(text ?? "").replace(EMAIL_RE, (m) => maskEmail(m));
}

// Already-masked emails ("j***@gmail.com") and order-number-like tokens ("#1234", "MX-1234", "1234").
const MASKED_EMAIL_RE = /\S*\*{3}@[a-z0-9.-]+\.[a-z]{2,}/gi;
const ORDER_TOKEN_RE = /#\s?[a-z0-9-]*\d[a-z0-9-]*|\b[a-z]{0,6}-?\d{3,}[a-z0-9-]*\b/gi;

/**
 * Stricter redaction for conversation HISTORY sent to the LLM: emails (raw or masked), phones and anything that
 * looks like an order/tracking number are removed.
 */
export function redactForLLM(text: string): string {
  return redactPII(String(text ?? "").replace(MASKED_EMAIL_RE, "[email]")).replace(ORDER_TOKEN_RE, "[number]");
}

/** Remove PII before anything leaves the server (LLM) or goes into meta. */
export function redactPII(text: string): string {
  return text
    .replace(EMAIL_RE, "[email]")
    .replace(/(?:\+?\d[\d\s().-]{8,}\d)/g, (m) => (m.replace(/\D/g, "").length >= 10 ? "[phone]" : m));
}

export function isAffirmative(text: string): boolean {
  const t = fold(text).replace(/[¡!¿?.,]/g, " ").trim();
  return /^(si|sip|simon|claro|ok|okay|va|vale|dale|andale|de acuerdo|por favor|porfa|porfavor|yes|yeah|yep|sure|please|of course|ok please|si por favor)\b/.test(t);
}

export function isNegative(text: string): boolean {
  const t = fold(text).replace(/[¡!¿?.,]/g, " ").trim();
  return /^(no|nel|nop|no gracias|no thanks|nope|nah)\b/.test(t);
}

export function isGreetingOnly(text: string): boolean {
  const t = fold(text).replace(/[¡!¿?.,:;)(]/g, " ").replace(/\s+/g, " ").trim();
  return /^((hola|holi|buen dia|buenos dias|buenas tardes|buenas noches|buenas|que tal|saludos|hey|hi|hello|good morning|good afternoon|good evening)\s*)+$/.test(t);
}

const COMPLAINT_RE = /\b(queja|reclamo|reclamacion|molest\w*|mal servicio|pesim\w*|terrible|horrible|no funciona|no sirve|dejo de funcionar|defectuos\w*|roto|rota|danad\w*|estropead\w*|complain\w*|broken|defective|doesn'?t work|does not work|not working|stopped working|awful|refund|reembolso|devolucion|devolver|garantia|warranty|return)\b/;
export function isComplaint(text: string): boolean {
  return COMPLAINT_RE.test(fold(text));
}

const INJECTION_RE = /(ignora\w* (todas |tus |las |los )*(instrucciones|reglas|indicaciones)|olvida\w* (tus |las )*(instrucciones|reglas)|ignore (all |any |your |the |previous |prior )*(instructions|rules)|disregard (all |your |previous )*(instructions|rules)|system prompt|prompt del sistema|actua como|act as|you are now|ahora eres|modo desarrollador|developer mode|jailbreak|revela tus instrucciones|reveal your (instructions|prompt))/;
export function looksLikeInjection(text: string): boolean {
  return INJECTION_RE.test(fold(text));
}

/** Trim to a max number of characters, preferring a sentence boundary. */
export function capLength(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  const cut = text.slice(0, maxChars);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "), cut.lastIndexOf(".\n"));
  if (lastStop > maxChars * 0.5) return cut.slice(0, lastStop + 1).trim();
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trim() + "…";
}
