"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { Badge, Button, Card, ConfirmDialog, inputCls } from "@/components/ui";
import { useT } from "@/lib/i18n-client";
import { dict } from "@/lib/context/dict";
import { CONTEXT_SECTION_KEYS, type ContextSectionKey } from "@/lib/types";
import { addSectionLinkAction, removeSectionFileAction, saveContextAction, setSectionSourceAction } from "./actions";

type Mode = "text" | "file";
type Status = "pending" | "indexed" | "error";
export interface SectionFileInfo { id: string; name: string; size: number | null; status: Status; error: string | null; preview: string }
export interface SourceOption { id: string; kind: "link" | "file"; title: string; url: string | null; status: Status; error: string | null }
type Msg = { tone: "good" | "bad"; text: string } | null;
type Keyed<T> = Record<ContextSectionKey, T>;

const PREVIEW = 400;
const keyed = <T,>(f: (k: ContextSectionKey) => T): Keyed<T> => Object.fromEntries(CONTEXT_SECTION_KEYS.map((k) => [k, f(k)])) as Keyed<T>;

export function ContextForm({ initial, modes: initialModes, files: initialFiles, links, sources = [] }: {
  initial: Keyed<string>;
  modes?: Keyed<Mode>;
  files?: Keyed<SectionFileInfo | null>;
  links?: Keyed<string[]>;
  sources?: SourceOption[];
}) {
  const t = useT(dict);
  const [values, setValues] = useState<Keyed<string>>(initial);
  const [saved, setSaved] = useState<Keyed<string>>(initial);
  const [modes, setModes] = useState<Keyed<Mode>>(() => initialModes ?? keyed(() => "text"));
  const [savedModes, setSavedModes] = useState<Keyed<Mode>>(() => initialModes ?? keyed(() => "text"));
  const [files, setFiles] = useState<Keyed<SectionFileInfo | null>>(() => initialFiles ?? keyed(() => null));
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle");
  const [cardMsg, setCardMsg] = useState<Partial<Keyed<Msg>>>({});
  const [uploading, setUploading] = useState<ContextSectionKey | null>(null);
  const [busyLink, setBusyLink] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<ContextSectionKey | null>(null);
  const [newUrl, setNewUrl] = useState<Partial<Keyed<string>>>({});
  const [pending, start] = useTransition();
  const [linkPending, startLink] = useTransition();
  const fileRefs = useRef<Partial<Keyed<HTMLInputElement | null>>>({});

  const linksOf = (k: ContextSectionKey) => links?.[k] ?? [];
  const linkedReady = (k: ContextSectionKey) => sources.filter((s) => linksOf(k).includes(s.id) && s.status === "indexed").length;
  const usingFile = (k: ContextSectionKey) => modes[k] === "file" && files[k]?.status === "indexed";
  const isFilled = (k: ContextSectionKey) => usingFile(k) || values[k].trim().length > 0 || linkedReady(k) > 0;

  const filled = CONTEXT_SECTION_KEYS.filter(isFilled).length;
  const total = CONTEXT_SECTION_KEYS.length;
  const dirty = CONTEXT_SECTION_KEYS.some((k) => values[k] !== saved[k] || modes[k] !== savedModes[k]);

  useEffect(() => {
    if (!dirty) return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [dirty]);

  const errText = (code: string | null | undefined) => {
    if (!code) return t("src.failed");
    if (code.startsWith("http_")) return t("err.http", { code: code.slice(5) });
    if (code === "bad_type") return t("up.badType");
    if (code === "too_big") return t("up.tooBig");
    if (code === "rate_limited") return t("ctx.err.rate_limited");
    return t(`err.${code}`) === `err.${code}` ? t("src.failed") : t(`err.${code}`);
  };
  const say = (k: ContextSectionKey, m: Msg) => setCardMsg((c) => ({ ...c, [k]: m }));
  const size = (n: number | null) => n == null ? "" : n >= 1024 * 1024 ? t("ctx.size.mb", { n: (n / 1024 / 1024).toFixed(1) }) : t("ctx.size.kb", { n: Math.max(1, Math.round(n / 1024)) });

  function save() {
    start(async () => {
      try {
        const r = await saveContextAction({ sections: values, modes });
        if (r.ok) { setSaved(values); setSavedModes(modes); setStatus("saved"); } else setStatus("error");
      } catch { setStatus("error"); }
    });
  }

  async function upload(k: ContextSectionKey, file: File | undefined) {
    if (!file) { say(k, { tone: "bad", text: t("up.noFile") }); return; }
    say(k, null); setUploading(k);
    try {
      const fd = new FormData();
      fd.append("section", k);
      fd.append("file", file);
      const res = await fetch("/api/context/section-file", { method: "POST", body: fd });
      const j = (await res.json().catch(() => ({}))) as { error?: string; indexed?: boolean; id?: string; name?: string; size?: number; preview?: string };
      if (!res.ok || !j.id) { say(k, { tone: "bad", text: errText(j.error) }); return; }
      setFiles((f) => ({ ...f, [k]: { id: j.id!, name: j.name ?? file.name, size: j.size ?? file.size, status: j.indexed ? "indexed" : "error", error: j.indexed ? null : j.error ?? null, preview: j.preview ?? "" } }));
      // The server switched this section to file mode already.
      setModes((m) => ({ ...m, [k]: "file" })); setSavedModes((m) => ({ ...m, [k]: "file" }));
      say(k, j.indexed ? { tone: "good", text: t("ctx.file.uploaded") } : { tone: "bad", text: t("ctx.file.errorFallback", { reason: errText(j.error) }) });
    } catch { say(k, { tone: "bad", text: t("src.failed") }); }
    finally {
      setUploading(null);
      const input = fileRefs.current[k]; if (input) input.value = "";
    }
  }

  function removeFile(k: ContextSectionKey) {
    setToRemove(null);
    startLink(async () => {
      try {
        const r = await removeSectionFileAction({ key: k });
        if (!r.ok) { say(k, { tone: "bad", text: t("src.failed") }); return; }
        setFiles((f) => ({ ...f, [k]: null }));
        setModes((m) => ({ ...m, [k]: "text" })); setSavedModes((m) => ({ ...m, [k]: "text" }));
        say(k, { tone: "good", text: t("ctx.file.removed") });
      } catch { say(k, { tone: "bad", text: t("src.failed") }); }
    });
  }

  function toggleLink(k: ContextSectionKey, sourceId: string, linked: boolean) {
    setBusyLink(`${k}:${sourceId}`);
    startLink(async () => {
      try {
        const r = await setSectionSourceAction({ key: k, sourceId, linked });
        say(k, r.ok ? { tone: "good", text: t(linked ? "ctx.src.linked" : "ctx.src.unlinked") } : { tone: "bad", text: errText(r.error) });
      } catch { say(k, { tone: "bad", text: t("src.failed") }); }
      finally { setBusyLink(null); }
    });
  }

  function addLink(k: ContextSectionKey) {
    const url = (newUrl[k] ?? "").trim();
    if (!url) return;
    setBusyLink(`${k}:new`);
    startLink(async () => {
      try {
        const r = await addSectionLinkAction({ key: k, url });
        if (!r.ok) { say(k, { tone: "bad", text: r.error === "invalid_url" ? t("src.invalidUrl") : errText(r.error) }); return; }
        setNewUrl((u) => ({ ...u, [k]: "" }));
        say(k, r.error ? { tone: "bad", text: errText(r.error) } : { tone: "good", text: t("ctx.src.added") });
      } catch { say(k, { tone: "bad", text: t("src.failed") }); }
      finally { setBusyLink(null); }
    });
  }

  const statusBadge = (s: Status) => (
    <Badge tone={s === "indexed" ? "good" : s === "error" ? "bad" : "warn"}>{t(`src.status.${s}`)}</Badge>
  );

  return (
    <div className="space-y-4 pb-24">
      <Card>
        <div className="flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-ink">{t("ctx.meter", { n: filled, total })}</p>
          <span className="text-sm text-muted">{Math.round((filled / total) * 100)}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-canvas" role="progressbar" aria-valuenow={filled} aria-valuemin={0} aria-valuemax={total}>
          <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${(filled / total) * 100}%` }} />
        </div>
        <p className="mt-2 text-xs text-muted">{t("ctx.meter.hint")}</p>
      </Card>

      {CONTEXT_SECTION_KEYS.map((k) => {
        const file = files[k];
        const fileMode = modes[k] === "file";
        const fileFailed = fileMode && file?.status === "error";
        const linkedIds = linksOf(k);
        const nLinked = linkedIds.filter((id) => sources.some((s) => s.id === id)).length;
        const usingText = usingFile(k) ? t("ctx.using.file", { name: file!.name }) : t("ctx.using.text");
        const extra = nLinked ? ` · ${nLinked === 1 ? t("ctx.using.sources.one") : t("ctx.using.sources", { n: nLinked })}` : "";
        const msg = cardMsg[k];
        return (
          <Card key={k}>
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <h2 id={`sec-${k}`} className="text-base font-semibold text-ink">{t(`sec.${k}.title`)}</h2>
              <div className="flex flex-wrap items-center gap-2">
                {!fileMode && !values[k].trim() && (
                  <Button type="button" variant="ghost" onClick={() => { setValues((v) => ({ ...v, [k]: t(`sec.${k}.ph`).replace(/^(Ejemplo|Example):\s*/, "") })); setStatus("idle"); }}>{t("ctx.useExample")}</Button>
                )}
                {fileFailed && <Badge tone="bad">{t("ctx.file.errorBadge")}</Badge>}
                <Badge tone={isFilled(k) ? "good" : "neutral"}>{isFilled(k) ? t("ctx.filled") : t("ctx.empty")}</Badge>
              </div>
            </div>
            <p className="mb-2 text-sm text-muted">{t(`sec.${k}.hint`)}</p>
            <p className="mb-3 text-xs font-medium text-ink" data-testid={`using-${k}`}>{usingText}{extra}</p>

            <div role="radiogroup" aria-label={`${t("ctx.mode.label")}: ${t(`sec.${k}.title`)}`} className="mb-3 inline-flex rounded-xl border border-line bg-canvas p-1">
              {(["text", "file"] as const).map((m) => (
                <label key={m} className={`flex min-h-11 cursor-pointer items-center rounded-lg px-4 text-sm font-medium transition has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand/50 ${modes[k] === m ? "bg-surface text-ink shadow-sm" : "text-muted hover:text-ink"}`}>
                  <input type="radio" className="sr-only" name={`mode-${k}`} value={m} checked={modes[k] === m}
                    onChange={() => { setModes((x) => ({ ...x, [k]: m })); setStatus("idle"); }} />
                  {t(`ctx.mode.${m}`)}
                </label>
              ))}
            </div>

            {!fileMode ? (
              <textarea
                className={`${inputCls} min-h-32 resize-y`}
                rows={5}
                maxLength={30000}
                value={values[k]}
                placeholder={t(`sec.${k}.ph`)}
                aria-labelledby={`sec-${k}`}
                onChange={(e) => { setValues((v) => ({ ...v, [k]: e.target.value })); setStatus("idle"); }}
              />
            ) : (
              <div className="space-y-3 rounded-xl border border-dashed border-line p-4">
                <input
                  ref={(el) => { fileRefs.current[k] = el; }} type="file" accept=".pdf,.docx,.txt,.md,.csv,.html" className="sr-only" tabIndex={-1} aria-hidden
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(k, f); }}
                />
                {!file ? (
                  <>
                    <p className="text-sm text-muted">{t("ctx.file.hint")}</p>
                    <Button type="button" disabled={uploading !== null} onClick={() => fileRefs.current[k]?.click()}>
                      {uploading === k ? t("ctx.file.uploading") : t("ctx.file.choose")}
                    </Button>
                    {values[k].trim() && <p className="text-xs text-muted">{t("ctx.file.none")}</p>}
                  </>
                ) : (
                  <>
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate font-medium text-ink">{file.name}</span>
                          {statusBadge(file.status)}
                        </div>
                        {file.size != null && <p className="text-xs text-muted">{size(file.size)}</p>}
                      </div>
                      <div className="flex shrink-0 flex-wrap gap-2">
                        <Button type="button" variant="secondary" disabled={uploading !== null || linkPending} onClick={() => fileRefs.current[k]?.click()}>
                          {uploading === k ? t("ctx.file.uploading") : t("ctx.file.replace")}
                        </Button>
                        <Button type="button" variant="ghost" className="text-danger" aria-label={`${t("ctx.file.remove")}: ${file.name}`} disabled={uploading !== null || linkPending} onClick={() => setToRemove(k)}>
                          {t("ctx.file.remove")}
                        </Button>
                      </div>
                    </div>
                    {file.status === "error" ? (
                      <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-900">{t("ctx.file.errorFallback", { reason: errText(file.error) })}</p>
                    ) : (
                      <>
                        <p className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">{t("ctx.file.note")}</p>
                        {file.preview && (
                          <div>
                            <p className="mb-1 text-xs font-medium text-muted">{t("ctx.file.preview")}</p>
                            <p className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-canvas px-3 py-2 text-xs text-ink">
                              {file.preview}{file.preview.length >= PREVIEW ? "…" : ""}
                            </p>
                          </div>
                        )}
                      </>
                    )}
                    {values[k].trim() && <p className="text-xs text-muted">{t("ctx.file.draftKept")}</p>}
                  </>
                )}
              </div>
            )}

            <details className="mt-3 rounded-xl border border-line">
              <summary className="flex min-h-11 cursor-pointer items-center justify-between gap-2 px-4 text-sm font-medium text-ink">
                <span>{t("ctx.src.title")}</span>
                {nLinked > 0 && <Badge tone="info">{nLinked}</Badge>}
              </summary>
              <div className="space-y-3 border-t border-line px-4 py-3">
                <p className="text-xs text-muted">{t("ctx.src.hint")}</p>
                {sources.length === 0 ? (
                  <p className="text-sm text-muted">{t("ctx.src.empty")}</p>
                ) : (
                  <ul className="divide-y divide-line">
                    {sources.map((s) => {
                      const checked = linkedIds.includes(s.id);
                      return (
                        <li key={s.id}>
                          <label className="flex min-h-11 cursor-pointer items-center gap-3 py-1">
                            <input type="checkbox" className="h-5 w-5 shrink-0 accent-brand" checked={checked}
                              disabled={linkPending && busyLink === `${k}:${s.id}`}
                              onChange={(e) => toggleLink(k, s.id, e.target.checked)} />
                            <span className="min-w-0 flex-1 truncate text-sm text-ink">{s.title}</span>
                            <Badge tone="neutral">{t(`src.kind.${s.kind}`)}</Badge>
                            {statusBadge(s.status)}
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
                <form className="flex flex-col gap-2 sm:flex-row" noValidate onSubmit={(e) => { e.preventDefault(); addLink(k); }}>
                  <label className="sr-only" htmlFor={`newlink-${k}`}>{t("ctx.src.addLink.label")}</label>
                  <input id={`newlink-${k}`} className={inputCls} type="url" inputMode="url" maxLength={2000} placeholder={t("src.add.urlPh")}
                    value={newUrl[k] ?? ""} onChange={(e) => setNewUrl((u) => ({ ...u, [k]: e.target.value }))} />
                  <Button type="submit" variant="secondary" className="shrink-0" disabled={linkPending || !(newUrl[k] ?? "").trim()}>
                    {linkPending && busyLink === `${k}:new` ? t("ctx.src.adding") : t("ctx.src.addLink")}
                  </Button>
                </form>
              </div>
            </details>

            <p className="mt-2 min-h-5 text-sm" role="status" aria-live="polite">
              {msg && <span className={msg.tone === "good" ? "text-ok" : "text-danger"}>{msg.text}</span>}
            </p>
          </Card>
        );
      })}

      <ConfirmDialog
        open={!!toRemove}
        title={t("ctx.file.confirmRemove", { name: toRemove ? files[toRemove]?.name ?? "" : "" })}
        body={t("ctx.file.confirmRemove.body")}
        confirmLabel={t("ctx.file.confirmRemove.yes")}
        cancelLabel={t("src.cancel")}
        onConfirm={() => toRemove && removeFile(toRemove)}
        onCancel={() => setToRemove(null)}
      />

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface/95 p-3 backdrop-blur pb-[max(0.75rem,env(safe-area-inset-bottom))] md:left-60">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3">
          <span id="ctx-status" className="text-sm" role="status" aria-live="polite">
            {pending ? <span className="text-muted">{t("ctx.saving")}</span>
              : status === "error" ? <span className="text-danger">{t("ctx.error")}</span>
              : dirty ? <span className="text-warn">{t("ctx.unsaved")}</span>
              : status === "saved" ? <span className="text-ok">{t("ctx.saved")}</span> : null}
          </span>
          <Button size="lg" onClick={save} disabled={pending || !dirty} aria-describedby="ctx-status">{pending ? t("ctx.saving") : t("ctx.save")}</Button>
        </div>
      </div>
    </div>
  );
}
