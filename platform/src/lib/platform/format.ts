// Pure formatting for the platform console (server pages and client parts). No data access.
import type { Locale } from "../i18n-shared";
import { compactNumber } from "./admin";

export type T = (key: string, vars?: Record<string, string | number>) => string;
export const intlLocale = (l: Locale) => (l === "en" ? "en-US" : "es-MX");

export function ago(iso: string | null, now: Date, t: T): string {
  if (!iso) return t("never");
  const ms = now.getTime() - Date.parse(iso);
  if (Number.isNaN(ms)) return t("never");
  const min = Math.floor(ms / 60_000);
  if (min < 1) return t("ago.now");
  if (min < 60) return t("ago.min", { n: min });
  const h = Math.floor(min / 60);
  if (h < 24) return t("ago.h", { n: h });
  return t("ago.d", { n: Math.floor(h / 24) });
}

export function shortDate(iso: string, locale: Locale, withTime = false): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(intlLocale(locale), {
    day: "2-digit", month: "short", ...(withTime ? { hour: "2-digit", minute: "2-digit" } : { year: "numeric" }), timeZone: "UTC",
  }).format(d);
}

export const usd = (n: number) => (n < 10 ? n.toFixed(2) : n.toFixed(0));

/** Audit row -> one human line. Details are codes written by lib/platform/console.ts (never personal data). */
export function describeEvent(action: string, detail: string, t: T): string {
  const has = (k: string) => t(k) !== k;
  const [a = "", b = ""] = detail.split(" ");
  let d = "";
  switch (action) {
    case "platform.tenant.suspended": d = t(`rs.${a}`); break;
    case "platform.tenant.plan": {
      const [from, to] = a.split(">");
      d = `${t(`plan.${from}`)} → ${t(`plan.${to}`)}${b ? ` · ${t(`rc.${b}`)}` : ""}`;
      break;
    }
    case "platform.tenant.ai_cap": {
      const [from, to] = a.split(">").map(Number);
      d = `${compactNumber(from || 0)} → ${compactNumber(to || 0)}${b ? ` · ${t(`rc.${b}`)}` : ""}`;
      break;
    }
    case "platform.legal_hold.lifted": d = t(`lr.${b}`); break;
  }
  return has(`ev.${action}`) ? t(`ev.${action}`, { d }) : t("ev.other", { a: action });
}

/** Who did it, without names: you, another platform admin, the business's team, Meta or the system. */
export function actorLabel(actor: string, action: string, me: string, t: T): string {
  if (actor === me) return t("au.you");
  if (actor === "meta-deletion") return t("origin.meta");
  if (actor === "system" || actor === "demo" || actor === "anonymous" || !actor) return t("au.system");
  return action.startsWith("platform.") ? t("au.admin") : t("origin.team");
}
