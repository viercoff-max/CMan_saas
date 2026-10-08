import { describe, expect, it } from "vitest";
import * as T from "../templates";

const TONES = [1, 2, 3, 4, 5] as const;
const LANGS = ["es", "en"] as const;
const emoji = /\p{Extended_Pictographic}/u;

const FUNCS: Record<string, (l: "es" | "en", t: T.Tone) => string> = {
  greeting: (l, t) => T.greeting(l, t, "Chefi"),
  shortHello: (l, t) => T.shortHello(l, t, "Chefi"),
  askOrderNumber: T.askOrderNumber,
  askEmail: T.askEmail,
  askNumberHaveEmail: T.askNumberHaveEmail,
  orderFound: (l, t) => T.orderFound(l, t, { orderNumber: "1234", statusText: l === "es" ? "Enviado" : "Shipped" }),
  orderNotFound: T.orderNotFound,
  noConnector: T.noConnector,
  orderLookupError: T.orderLookupError,
  clarify: T.clarify,
  capOffer: T.capOffer,
  offerDeclined: T.offerDeclined,
  defaultFallbackText: T.defaultFallbackText,
  handoffWhen_closed: (l, t) => T.handoffWhen(l, t, false, "9-18"),
};
for (const k of ["legal", "human_request", "no_answer", "blocked", "attempts", "too_old", "bot_disabled"] as const) {
  FUNCS[`handoff_${k}`] = (l, t) => T.handoffIntro(k, l, t);
}

describe("five distinct tone registers", () => {
  for (const [name, fn] of Object.entries(FUNCS)) {
    for (const lang of LANGS) {
      if (name === "handoffWhen_closed" && lang === "en") continue; // English closed-hours line is a single register
      it(`${name} (${lang}) yields 5 different strings`, () => {
        expect(new Set(TONES.map((t) => fn(lang, t))).size).toBe(5);
      });
    }
  }

  it("emoji only at tone 5 (never tones 1-3) for customer-facing replies", () => {
    for (const [name, fn] of Object.entries(FUNCS)) for (const lang of LANGS) for (const t of [1, 2, 3] as const) {
      expect(fn(lang, t), `${name} ${lang} ${t}`).not.toMatch(emoji);
    }
  });
  it("tones 1-2 use usted, 3-5 use tu (es)", () => {
    expect(T.askEmail("es", 2)).toMatch(/realizó/);
    expect(T.askEmail("es", 3)).toMatch(/hiciste/);
    expect(T.orderFound("es", 2, { orderNumber: "1" })).toMatch(/su pedido/);
    expect(T.orderFound("es", 4, { orderNumber: "1" })).toMatch(/tu pedido/i);
  });
  it("safety text never has emoji and keeps formal/informal families", () => {
    for (const t of TONES) for (const l of LANGS) expect(T.safetyIntro(l, t)).not.toMatch(emoji);
    expect(T.safetyIntro("es", 1)).toMatch(/desconéctelo/);
    expect(T.safetyIntro("es", 5)).toMatch(/desconéctalo/);
  });
  it("custom fallback still overrides no_answer/blocked", () => {
    expect(T.handoffIntro("no_answer", "es", 1, " Hola ")).toBe("Hola");
  });
  it("short hello without an agent name has no dangling comma", () => {
    for (const t of TONES) expect(T.shortHello("es", t, "")).not.toMatch(/soy|,\s*\./);
  });
});
