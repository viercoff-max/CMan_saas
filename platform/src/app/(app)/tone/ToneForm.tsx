"use client";
import { useEffect, useState, useTransition } from "react";
import { Button, Card, Field, inputCls } from "@/components/ui";
import { useLocale, useT } from "@/lib/i18n-client";
import { dict } from "@/lib/context/dict";
import { isOvernight, type BusinessHours } from "@/lib/context/settings";
import { tzOptions } from "@/lib/context/timezones";
import * as T from "@/lib/engine/templates";
import { saveToneAction } from "./actions";

export interface ToneInitial {
  agentName: string; toneLevel: number; languageDefault: "es" | "en"; greeting: string; fallbackMessage: string;
  handoffEmail: string; crossSellLevel: number; hours: BusinessHours;
}

export function ToneForm({ initial, hoursSaved = true }: { initial: ToneInitial; hoursSaved?: boolean }) {
  const t = useT(dict);
  const uiLocale = useLocale();
  const [v, setV] = useState<ToneInitial>(initial);
  const [savedV, setSavedV] = useState<ToneInitial>(initial);
  const [previewLang, setPreviewLang] = useState<"es" | "en">(uiLocale);
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [pending, start] = useTransition();
  const set = <K extends keyof ToneInitial>(k: K, val: ToneInitial[K]) => { setV((p) => ({ ...p, [k]: val })); setStatus("idle"); };
  const setHours = <K extends keyof BusinessHours>(k: K, val: BusinessHours[K]) => set("hours", { ...v.hours, [k]: val });
  const tzList = tzOptions(v.hours.timezone, uiLocale);
  // A never-saved tenant sees the default hours as a proposal: the engine ignores them until Save.
  const [hoursPersisted, setHoursPersisted] = useState(hoursSaved);
  const sameTimes = v.hours.open === v.hours.close;
  const overnight = !sameTimes && isOvernight(v.hours);
  const dirty = JSON.stringify(v) !== JSON.stringify(savedV) || !hoursPersisted;

  // The preview is built from the REAL reply templates the engine uses (no invented content).
  const tone = T.clampTone(v.toneLevel);
  const name = v.agentName.trim();
  const customGreeting = v.greeting.trim();
  const customFallback = v.fallbackMessage.trim();
  const useCustom = previewLang === v.languageDefault;
  const greetingDefault = T.greeting(previewLang, tone, name);
  const fallbackDefault = T.defaultFallbackText(previewLang, tone);
  const exchanges: { q: string; a: string }[] = [
    { q: dict[previewLang]["tone.q1." + previewLang], a: useCustom && customGreeting ? customGreeting : greetingDefault },
    { q: dict[previewLang]["tone.q2." + previewLang], a: T.askOrderNumber(previewLang, tone) },
    { q: dict[previewLang]["tone.q3." + previewLang], a: useCustom && customFallback ? customFallback : fallbackDefault },
  ];

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  function save() {
    start(async () => {
      try {
        const r = await saveToneAction({ ...v });
        if (r.ok) { const next = { ...v, greeting: r.greeting, fallbackMessage: r.fallbackMessage }; setV(next); setSavedV(next); setHoursPersisted(true); setStatus("saved"); }
        else setStatus("error");
      } catch { setStatus("error"); }
    });
  }

  return (
    <div className="space-y-4 pb-24">
      <Card>
        <Field label={t("tone.name")} hint={t("tone.name.hint")}>
          <input className={inputCls} value={v.agentName} maxLength={60} onChange={(e) => set("agentName", e.target.value)} />
        </Field>
      </Card>

      <Card>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-base font-semibold text-ink">{t("tone.level")}</h2>
          <span className="rounded-full bg-brand/10 px-3 py-1 text-sm font-medium text-brand">{t("tone.level.n", { n: v.toneLevel })}</span>
        </div>
        <input
          type="range" min={1} max={5} step={1} value={v.toneLevel}
          aria-label={t("tone.level")}
          onChange={(e) => set("toneLevel", Number(e.target.value))}
          className="h-3 w-full cursor-pointer accent-brand"
        />
        <div className="mt-1 flex justify-between text-xs text-muted"><span>{t("tone.level.serious")}</span><span>{t("tone.level.friendly")}</span></div>
        <div className="mt-2 flex justify-between px-1" aria-hidden>
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" tabIndex={-1} onClick={() => set("toneLevel", n)}
              className={`h-11 w-11 rounded-full text-sm ${v.toneLevel === n ? "bg-brand text-on-brand" : "bg-canvas text-muted hover:text-ink"}`}>{n}</button>
          ))}
        </div>

        <div className="mt-5 rounded-xl bg-canvas p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm font-medium text-ink">{t("tone.preview")}</p>
            <div className="flex gap-1" role="group" aria-label={t("tone.previewLang")}>
              {(["es", "en"] as const).map((l) => (
                <button key={l} type="button" onClick={() => setPreviewLang(l)} aria-pressed={previewLang === l}
                  className={`min-h-11 rounded-lg px-4 text-sm font-medium ${previewLang === l ? "bg-brand text-on-brand" : "border border-line bg-surface text-muted"}`}>{l.toUpperCase()}</button>
              ))}
            </div>
          </div>
          <p className="mb-3 text-xs text-muted">{t("tone.preview.note")}</p>
          <div className="space-y-3 text-sm">
            {exchanges.map((x, i) => (
              <div key={i} className="space-y-2">
                <div className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm border border-line bg-surface px-3 py-2 text-ink">
                  <span className="mb-0.5 block text-xs text-muted">{t("tone.preview.customer")}</span>
                  {x.q}
                </div>
                <div className="max-w-[85%] whitespace-pre-line rounded-2xl rounded-bl-sm bg-brand px-3 py-2 text-on-brand">
                  <span className="mb-0.5 block text-xs opacity-80">{name || "Asistente"}</span>
                  {x.a}
                </div>
              </div>
            ))}
          </div>
        </div>
      </Card>

      <Card>
        <div className="space-y-4">
          <Field label={t("tone.greeting")} hint={t("tone.greeting.hint")}>
            <textarea className={inputCls} rows={2} maxLength={500} value={v.greeting} placeholder={T.greeting(v.languageDefault, tone, name)} onChange={(e) => set("greeting", e.target.value)} />
          </Field>
          <Field label={t("tone.fallback")} hint={t("tone.fallback.hint")}>
            <textarea className={inputCls} rows={3} maxLength={800} value={v.fallbackMessage} placeholder={T.defaultFallbackText(v.languageDefault, tone)} onChange={(e) => set("fallbackMessage", e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-base font-semibold text-ink">{t("tone.cross")}</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {[0, 1, 2, 3].map((n) => (
            <label key={n} className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${v.crossSellLevel === n ? "border-brand bg-brand/5" : "border-line"}`}>
              <input type="radio" name="cross" className="mt-1 accent-brand" checked={v.crossSellLevel === n} onChange={() => set("crossSellLevel", n)} />
              <span>
                <span className="block text-sm font-medium text-ink">{t(`tone.cross.${n}`)}</span>
                <span className="block text-xs text-muted">{t(`tone.cross.${n}.d`)}</span>
              </span>
            </label>
          ))}
        </div>
      </Card>

      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t("tone.lang")} hint={t("tone.lang.hint")}>
            <select className={inputCls} value={v.languageDefault} onChange={(e) => set("languageDefault", e.target.value === "en" ? "en" : "es")}>
              <option value="es">{t("tone.lang.es")}</option>
              <option value="en">{t("tone.lang.en")}</option>
            </select>
          </Field>
          <Field label={t("tone.email")} hint={t("tone.email.hint")}>
            <input type="email" className={inputCls} value={v.handoffEmail} maxLength={200} placeholder="soporte@tuempresa.com" onChange={(e) => set("handoffEmail", e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card>
        <h2 className="text-base font-semibold text-ink">{t("tone.hours")}</h2>
        <p className="mb-3 text-sm text-muted">{t("tone.hours.hint")}</p>
        {!hoursPersisted && (
          <p className="mb-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-sm text-ink" role="note">{t("tone.hours.unset")}</p>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label={t("tone.from")}>
            <select className={inputCls} value={v.hours.fromDay} onChange={(e) => setHours("fromDay", Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{t(`day.${d}`)}</option>)}
            </select>
          </Field>
          <Field label={t("tone.to")}>
            <select className={inputCls} value={v.hours.toDay} onChange={(e) => setHours("toDay", Number(e.target.value))}>
              {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{t(`day.${d}`)}</option>)}
            </select>
          </Field>
          <Field label={t("tone.open")}>
            <input type="time" className={inputCls} value={v.hours.open} onChange={(e) => e.target.value && setHours("open", e.target.value)} />
          </Field>
          <Field label={t("tone.close")}>
            <input type="time" className={inputCls} value={v.hours.close} onChange={(e) => e.target.value && setHours("close", e.target.value)} />
          </Field>
        </div>
        {sameTimes ? <p className="mt-2 text-sm text-danger" role="alert">{t("tone.hours.same")}</p>
          : overnight ? <p className="mt-2 text-sm text-muted">{t("tone.hours.overnight")}</p> : null}
        <div className="mt-3 max-w-sm">
          <Field label={t("tone.tz")} hint={t("tone.tzHint")}>
            <select className={inputCls} value={v.hours.timezone} onChange={(e) => setHours("timezone", e.target.value)}>
              {tzList.map((z) => <option key={z.value} value={z.value}>{z.label}</option>)}
            </select>
          </Field>
        </div>
      </Card>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface/95 p-3 backdrop-blur pb-[max(0.75rem,env(safe-area-inset-bottom))] md:left-60">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <span className="text-sm" role="status" aria-live="polite">
            {pending ? <span className="text-muted">{t("tone.saving")}</span>
              : status === "error" ? <span className="text-danger">{t("tone.error")}</span>
              : dirty ? <span className="text-warn">{t("tone.unsaved")}</span>
              : status === "saved" ? <span className="text-ok">{t("tone.saved")}</span> : null}
          </span>
          <Button size="lg" onClick={save} disabled={pending || !dirty || sameTimes}>{pending ? t("tone.saving") : t("tone.save")}</Button>
        </div>
      </div>
    </div>
  );
}
