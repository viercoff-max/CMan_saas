"use client";
// Brand editor: the /brand screen (mode "full") and onboarding step 2 (mode "onboarding": logo + main colour only).
// The live preview and the contrast badges use the SAME theme engine the server uses for the shell
// (src/lib/brand/theme.ts), so what you see here is exactly what the panel will look like.
import { useEffect, useId, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, Field, inputCls } from "@/components/ui";
import { BrandMark } from "@/components/Sidebar";
import { useLocale, useT } from "@/lib/i18n-client";
import {
  computeTheme, HEADING_FONT_KEYS, HEADING_FONTS, isHexColor, PLATFORM_BRAND, ratioLabel, themeStyle, type Theme,
} from "@/lib/brand/theme";
import { brandDict } from "./dict";

export interface BrandFormInitial {
  displayName: string; primaryColor: string; accentColor: string; menuBgColor: string; headingFont: string; logoUrl: string | null;
}
type ColorKey = "primaryColor" | "accentColor" | "menuBgColor";
type FieldErr = Partial<Record<ColorKey | "displayName", true>>;

const LOGO_TYPES = ["image/png", "image/jpeg", "image/webp"];
const LOGO_MAX = 2 * 1024 * 1024;
/** Client-side pre-check with the same rules (and messages) as the server's uploadLogo. */
export function checkLogoFile(f: { size: number; type: string }): "empty" | "too_big" | "bad_type" | null {
  if (f.size === 0) return "empty";
  if (f.size > LOGO_MAX) return "too_big";
  if (!LOGO_TYPES.includes(f.type)) return "bad_type";
  return null;
}

export function BrandForm({ initial, mode = "full", doneHref = "/dashboard" }: { initial: BrandFormInitial; mode?: "full" | "onboarding"; doneHref?: string }) {
  const t = useT(brandDict);
  const locale = useLocale();
  const router = useRouter();
  const ids = useId();
  const [displayName, setDisplayName] = useState(initial.displayName);
  const [hex, setHex] = useState<Record<ColorKey, string>>({ primaryColor: initial.primaryColor, accentColor: initial.accentColor, menuBgColor: initial.menuBgColor });
  // Last VALID value of each colour (the preview never breaks while someone is typing a code).
  const [valid, setValid] = useState<Record<ColorKey, string>>({ ...hex });
  const [font, setFont] = useState(HEADING_FONT_KEYS.includes(initial.headingFont as never) ? initial.headingFont : "system");
  const [file, setFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [savedLogo, setSavedLogo] = useState(initial.logoUrl);
  const [errors, setErrors] = useState<FieldErr>({});
  const [logoErr, setLogoErr] = useState<string | null>(null);
  const [status, setStatus] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [pending, setPending] = useState(false);

  useEffect(() => () => { if (fileUrl) URL.revokeObjectURL(fileUrl); }, [fileUrl]);

  const theme = useMemo(() => computeTheme({ ...valid, headingFont: font }), [valid, font]);
  const shownLogo = fileUrl ?? (removeLogo ? null : savedLogo);
  const full = mode === "full";

  function setColor(k: ColorKey, v: string) {
    const next = v.startsWith("#") ? v : `#${v}`;
    setHex((h) => ({ ...h, [k]: next }));
    if (isHexColor(next)) { setValid((s) => ({ ...s, [k]: next.toUpperCase() })); setErrors((e) => ({ ...e, [k]: undefined })); }
    else setErrors((e) => ({ ...e, [k]: true }));
  }
  function pickFile(f: File | null | undefined) {
    setStatus(null);
    if (!f) return;
    const bad = checkLogoFile(f);
    if (bad) { setLogoErr(t(`err.${bad}`)); return; }
    setLogoErr(null);
    setRemoveLogo(false);
    setFile(f);
    setFileUrl(URL.createObjectURL(f));
  }
  function reset() {
    const d = { primaryColor: PLATFORM_BRAND.primaryColor, accentColor: PLATFORM_BRAND.accentColor, menuBgColor: PLATFORM_BRAND.menuBgColor };
    setHex(d); setValid(d); setFont(PLATFORM_BRAND.headingFont); setErrors({}); setStatus(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setStatus(null);
    const errs: FieldErr = {};
    const keys: ColorKey[] = full ? ["primaryColor", "accentColor", "menuBgColor"] : ["primaryColor"];
    for (const k of keys) if (!isHexColor(hex[k])) errs[k] = true;
    if (full && (!displayName.trim() || displayName.trim().length > 120)) errs.displayName = true;
    setErrors(errs);
    if (Object.keys(errs).length) { setStatus({ tone: "error", text: t("err.invalid") }); return; }

    const body = new FormData();
    for (const k of keys) body.set(k, hex[k]);
    if (full) { body.set("displayName", displayName.trim()); body.set("headingFont", font); }
    if (file) body.set("logo", file);
    else if (removeLogo) body.set("removeLogo", "1");
    setPending(true);
    try {
      const res = await fetch("/brand/save", { method: "POST", body });
      const j = await res.json().catch(() => ({})) as { ok?: boolean; error?: string; field?: string; logoUrl?: string | null; changed?: string[] };
      if (!res.ok || !j.ok) {
        const err = j.error ?? "failed";
        if (j.field) setErrors((x) => ({ ...x, [j.field as string]: true }));
        if (err === "empty" || err === "too_big" || err === "bad_type") setLogoErr(t(`err.${err}`));
        const known = ["empty", "too_big", "bad_type", "forbidden", "rate_limited", "invalid"].includes(err);
        setStatus({ tone: "error", text: t(`err.${known ? err : "failed"}`) });
        return;
      }
      setFile(null); setFileUrl(null); setRemoveLogo(false); setSavedLogo(j.logoUrl ?? null);
      if (!full) { router.push(doneHref); return; }
      setStatus({ tone: "ok", text: t(j.changed?.length ? "saved" : "nochange") });
      router.refresh(); // the (app) layout re-renders the shell with the new theme
    } catch {
      setStatus({ tone: "error", text: t("err.failed") });
    } finally {
      setPending(false);
    }
  }

  const colorRow = (k: ColorKey, label: string, hint: string) => (
    <div>
      <span id={`${ids}-${k}`} className="mb-1 block text-sm font-medium text-ink">{label}</span>
      <div className="flex gap-2">
        <input type="color" aria-labelledby={`${ids}-${k}`} value={valid[k].toLowerCase()} onChange={(e) => setColor(k, e.target.value.toUpperCase())}
          className="h-11 w-14 shrink-0 cursor-pointer rounded-xl border border-line bg-surface p-1" />
        <input aria-label={`${label}: ${t("hex")}`} value={hex[k]} maxLength={7} spellCheck={false} autoCapitalize="characters"
          onChange={(e) => setColor(k, e.target.value.trim())} aria-invalid={errors[k] ? true : undefined}
          aria-describedby={`${ids}-${k}-hint`} className={`${inputCls} font-mono uppercase ${errors[k] ? "border-danger" : ""}`} />
      </div>
      <span id={`${ids}-${k}-hint`} className={`mt-1 block text-xs ${errors[k] ? "text-danger" : "text-muted"}`}>{errors[k] ? t("err.hex") : hint}</span>
    </div>
  );

  const logoBlock = (
    <div>
      <span className="mb-1 block text-sm font-medium text-ink">{t("logo")}</span>
      <label
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); pickFile(e.dataTransfer.files?.[0]); }}
        className="flex cursor-pointer items-center gap-4 rounded-2xl border-2 border-dashed border-line p-4 focus-within:border-focus-ring hover:bg-canvas">
        <span data-brand="" style={themeStyle(theme) as CSSProperties}><BrandMark name={displayName || "?"} logoUrl={shownLogo} size={56} /></span>
        <span className="min-w-0 text-sm">
          <span className="block font-medium text-ink">{t("logo.drop")} · <span className="text-brand-ink underline underline-offset-2">{t("logo.choose")}</span></span>
          <span className="mt-1 block text-xs text-muted">{t("logo.hint")}</span>
          {file && <span className="mt-1 block text-xs text-ink">{t("logo.selected")}</span>}
        </span>
        <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only"
          onChange={(e) => { pickFile(e.target.files?.[0]); e.target.value = ""; }} />
      </label>
      {logoErr && <p role="alert" className="mt-1 text-sm text-danger">{logoErr}</p>}
      {full && (savedLogo || file) && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          {removeLogo && <span className="text-muted">{t("logo.removed")}</span>}
          <Button type="button" variant="ghost" onClick={() => { if (file) { setFile(null); setFileUrl(null); } else setRemoveLogo((r) => !r); }}>
            {removeLogo ? t("logo.undoRemove") : t("logo.remove")}
          </Button>
        </div>
      )}
    </div>
  );

  return (
    <form onSubmit={submit} noValidate className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="space-y-5">
        {logoBlock}
        {full && (
          <Field label={t("displayName")}>
            <input value={displayName} maxLength={120} onChange={(e) => setDisplayName(e.target.value)} aria-invalid={errors.displayName ? true : undefined}
              className={`${inputCls} ${errors.displayName ? "border-danger" : ""}`} />
            {errors.displayName && <span className="mt-1 block text-xs text-danger">{t("err.displayName")}</span>}
          </Field>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {colorRow("primaryColor", t("primary"), t("primary.hint"))}
          {full && colorRow("accentColor", t("accent"), t("accent.hint"))}
        </div>
        {full && colorRow("menuBgColor", t("menu"), t("menu.hint"))}
        {full && (
          <Field label={t("font")} hint={t("font.hint")}>
            <select value={font} onChange={(e) => setFont(e.target.value)} className={inputCls}>
              {HEADING_FONT_KEYS.map((k) => <option key={k} value={k}>{HEADING_FONTS[k][locale]}</option>)}
            </select>
          </Field>
        )}
        <ContrastReport theme={theme} full={full} t={t} />
        {status && <p role={status.tone === "error" ? "alert" : "status"} className={`rounded-xl px-3 py-2 text-sm ${status.tone === "error" ? "bg-danger/10 text-danger" : "bg-green-100 text-green-900"}`}>{status.text}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          {full ? (
            <Button type="button" variant="ghost" onClick={reset} aria-describedby="brand-reset-hint">↺ {t("reset")}</Button>
          ) : (
            <Link href={doneHref} className="inline-flex min-h-11 items-center px-2 text-sm text-muted underline underline-offset-2 hover:text-ink">{t("onb.later")}</Link>
          )}
          <Button type="submit" size="lg" disabled={pending}>{pending ? t("saving") : full ? t("save") : t("onb.continue")}</Button>
        </div>
        {full && <p id="brand-reset-hint" className="text-xs text-muted">{t("reset.hint")}</p>}
      </Card>
      <div className="space-y-4">
        <BrandPreview theme={theme} name={full ? displayName || initial.displayName : initial.displayName} logoUrl={shownLogo} t={t} />
        {full && (
          <Card>
            <p className="text-sm font-medium text-ink">👁 {t("where")}</p>
            <p className="mt-1 text-sm text-muted">{t("where.body")}</p>
          </Card>
        )}
      </div>
    </form>
  );
}

type T = (k: string, v?: Record<string, string | number>) => string;

function ReportRow({ sample, text, ratio, t }: { sample: ReactNode; text: string; ratio: number; t: T }) {
  const r = ratioLabel(ratio);
  return (
    <li className="flex flex-wrap items-center gap-3 py-2">
      {sample}
      <span className="min-w-0 flex-1 text-sm text-ink">{text}</span>
      <span aria-label={t("report.badgeLabel", { ratio: r })}><Badge tone={ratio >= 4.5 ? "good" : "bad"}>✓ {t("report.badge", { ratio: r })}</Badge></span>
    </li>
  );
}

export function ContrastReport({ theme, full, t }: { theme: Theme; full: boolean; t: T }) {
  const style = themeStyle(theme) as CSSProperties;
  const chip = "inline-flex min-w-16 justify-center rounded-lg px-2.5 py-1 text-xs font-semibold";
  return (
    <div data-brand="" style={style} className="rounded-2xl border border-line px-4 py-1">
      <p className="sr-only">{t("report.title")}</p>
      <ul className="divide-y divide-line">
        <ReportRow t={t} ratio={theme.report.buttonRatio} sample={<span className={`${chip} bg-brand text-on-brand`}>{t("report.button")}</span>}
          text={t("report.buttonText", { color: t(theme.report.onBrand === "light" ? "report.white" : "report.dark") })} />
        <ReportRow t={t} ratio={theme.report.linkRatio} sample={<span className={`${chip} border border-line bg-surface text-brand-ink`}>{t("report.link")}</span>}
          text={t(theme.report.linkAdjusted ? "report.linkAdjusted" : "report.linkText")} />
        {full && (
          <ReportRow t={t} ratio={theme.report.accentRatio} sample={<span className={`${chip} bg-brand-accent text-on-brand-accent`}>{t("report.accent")}</span>}
            text={t("report.accentText")} />
        )}
      </ul>
    </div>
  );
}

export function BrandPreview({ theme, name, logoUrl, t }: { theme: Theme; name: string; logoUrl: string | null; t: T }) {
  return (
    <section aria-labelledby="brand-preview-title">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 id="brand-preview-title" className="text-base font-semibold text-ink">{t("preview")}</h2>
        <span className="text-xs text-muted">{t("preview.hint")}</span>
      </div>
      {/* Decorative copy of the panel: not interactive, hidden from screen readers except the heading above. */}
      <div data-brand="" style={themeStyle(theme) as CSSProperties} aria-hidden className="overflow-hidden rounded-2xl border border-line bg-canvas shadow-sm">
        <div className="flex items-center gap-1.5 border-b border-line bg-surface px-3 py-2 text-xs text-muted">
          <span className="h-2.5 w-2.5 rounded-full bg-line" /><span className="h-2.5 w-2.5 rounded-full bg-line" /><span className="h-2.5 w-2.5 rounded-full bg-line" />
          <span className="ml-2">{t("preview.panel")}</span>
        </div>
        <div className="flex">
          <div className="hidden w-36 shrink-0 space-y-1 border-r border-line bg-menu-bg p-2 text-menu-ink sm:block">
            <div className="mb-2 flex items-center gap-2 px-1">
              <BrandMark name={name || "?"} logoUrl={logoUrl} size={24} />
              <span className="truncate text-sm font-semibold [font-family:var(--heading-font)]">{name}</span>
            </div>
            <div className="rounded-lg px-2 py-1.5 text-xs text-menu-muted">🏠 {t("preview.nav.home")}</div>
            <div className="rounded-lg bg-brand px-2 py-1.5 text-xs font-medium text-on-brand">💬 {t("preview.nav.inbox")}</div>
            <div className="rounded-lg px-2 py-1.5 text-xs text-menu-muted">📝 {t("preview.nav.context")}</div>
          </div>
          <div className="min-w-0 flex-1 space-y-3 p-3">
            <p className="text-base font-semibold text-ink [font-family:var(--heading-font)]">{t("preview.inbox")}</p>
            <div className="rounded-xl border border-line bg-brand-soft p-2.5">
              <p className="text-sm font-medium text-ink">{t("preview.customer")}</p>
              <p className="text-xs text-ink">{t("preview.waiting")}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="inline-flex min-h-9 items-center rounded-lg bg-brand px-3 text-sm font-medium text-on-brand">{t("preview.reply")}</span>
              <span className="inline-flex min-h-9 items-center rounded-lg border border-line bg-surface px-3 text-sm text-ink">{t("preview.return")}</span>
            </div>
            <span className="block text-sm text-brand-ink underline underline-offset-2">{t("preview.all")}</span>
          </div>
        </div>
        <div className="border-t border-line p-3">
          <div className="ml-auto max-w-xs overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
            <div className="flex items-center gap-2 bg-brand px-3 py-2 text-on-brand">
              <BrandMark name={name || "?"} logoUrl={logoUrl} size={24} />
              <span className="truncate text-sm font-semibold">{name}</span>
            </div>
            <div className="space-y-2 bg-canvas p-3 text-sm">
              <p className="mr-8 rounded-2xl rounded-tl-sm border border-line bg-surface px-3 py-2 text-ink">{t("preview.chat.bot")}</p>
              <p className="ml-8 rounded-2xl rounded-tr-sm bg-canvas px-3 py-2 text-right text-ink ring-1 ring-line">{t("preview.chat.customer")}</p>
              <p className="mr-8 rounded-2xl rounded-tl-sm bg-brand-accent px-3 py-2 text-on-brand-accent">{t("preview.chat.team")}</p>
            </div>
            <div className="flex items-center gap-2 border-t border-line p-2">
              <span className="flex-1 truncate rounded-full border border-line px-3 py-1.5 text-xs text-muted">{t("preview.chat.input")}</span>
              <span className="rounded-full bg-brand px-3 py-1.5 text-xs font-semibold text-on-brand">{t("preview.chat.send")}</span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
