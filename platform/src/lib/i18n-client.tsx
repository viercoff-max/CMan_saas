"use client";
// Client-side counterpart of i18n.ts. The (app) layout wraps children in <LocaleProvider>.
import { createContext, useContext } from "react";
import type { Dict, Locale } from "./i18n-shared";

const Ctx = createContext<Locale>("es");
export function LocaleProvider({ locale, children }: { locale: Locale; children: React.ReactNode }) {
  return <Ctx.Provider value={locale}>{children}</Ctx.Provider>;
}
export const useLocale = () => useContext(Ctx);
export function useT(dict: Dict) {
  const locale = useContext(Ctx);
  return (key: string, vars?: Record<string, string | number>) => {
    let s = dict[locale][key] ?? dict.es[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}
