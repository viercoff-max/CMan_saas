// Tiny i18n. UI default is Spanish; users can switch to English (cookie "locale").
// Each module owns its own dictionary file and calls makeT(dict, locale). No central registry => no merge conflicts.
import { cookies } from "next/headers";
import type { Dict, Locale } from "./i18n-shared";
export type { Dict, Locale };

export async function getLocale(): Promise<Locale> {
  const v = (await cookies()).get("locale")?.value;
  return v === "en" ? "en" : "es";
}
export function makeT(dict: Dict, locale: Locale) {
  return (key: string, vars?: Record<string, string | number>) => {
    let s = dict[locale][key] ?? dict.es[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}
