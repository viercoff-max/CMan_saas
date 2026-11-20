// Pure math for "Plan y uso" and the dashboard "Uso de IA del mes" KPI (tested in __tests__/usage.test.ts).
// Tokens = input + output of the UTC calendar month (same as usage.remaining in the data layer).

export interface UsageMeter {
  used: number;
  cap: number;
  /** 0..100, rounded down (never overstates headroom). 100 when the cap is 0 or exceeded. */
  percent: number;
  /** cap - used, never negative. */
  remaining: number;
  overCap: boolean;
  /** No monthly AI budget at all (cap 0). */
  noCap: boolean;
}

const n = (v: unknown) => Math.max(0, Math.floor(Number(v) || 0));

export function usageMeter(cap: unknown, inputTokens: unknown, outputTokens: unknown): UsageMeter {
  const c = n(cap);
  const used = n(inputTokens) + n(outputTokens);
  if (c === 0) return { used, cap: 0, percent: 100, remaining: 0, overCap: used > 0, noCap: true };
  return {
    used, cap: c,
    percent: Math.min(100, Math.floor((used / c) * 100)),
    remaining: Math.max(0, c - used),
    overCap: used >= c,
    noCap: false,
  };
}

/** The monthly budget renews on the 1st of next month, 00:00 UTC. */
export function renewalDate(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
}
/** First instant of the current UTC month. */
export function monthStart(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

/** Real-customer conversations (simulator excluded) with a message in the current UTC month. */
export function countConversationsThisMonth(rows: { channel: string; lastMessageAt: string }[], now: Date = new Date()): number {
  const start = monthStart(now).getTime(), end = renewalDate(now).getTime();
  return rows.filter((r) => {
    if (r.channel === "simulator") return false;
    const t = Date.parse(r.lastMessageAt);
    return Number.isFinite(t) && t >= start && t < end;
  }).length;
}

export const fmtDate = (d: Date, locale: "es" | "en", opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "long" }) =>
  new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", { ...opts, timeZone: "UTC" }).format(d);
export const fmtMonth = (d: Date, locale: "es" | "en") =>
  new Intl.DateTimeFormat(locale === "en" ? "en-US" : "es-MX", { month: "long", timeZone: "UTC" }).format(d);
export const fmtNum = (v: number, locale: "es" | "en") => new Intl.NumberFormat(locale === "en" ? "en-US" : "es-MX").format(v);
