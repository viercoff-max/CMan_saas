"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, ConfirmDialog, Field, inputCls } from "@/components/ui";
import { useLocale, useT } from "@/lib/i18n-client";
import { dict } from "@/lib/context/dict";
import { addLinkAction, deleteSourceAction, syncSourceAction } from "./actions";

interface Row {
  id: string; kind: "link" | "file"; title: string; url: string | null;
  status: "pending" | "indexed" | "error"; error: string | null; lastSyncedAt: string | null;
  /** Context sections this source complements (already translated titles). */
  sections?: string[];
}
type Msg = { tone: "good" | "bad"; text: string } | null;

export function SourcesManager({ sources }: { sources: Row[] }) {
  const t = useT(dict);
  const locale = useLocale();
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [fileName, setFileName] = useState("");
  const [toDelete, setToDelete] = useState<Row | null>(null);
  const [pending, start] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const errText = (code: string | null | undefined) => {
    if (!code) return "";
    if (code.startsWith("http_")) return t("err.http", { code: code.slice(5) });
    return t(`err.${code}`) === `err.${code}` ? t("src.failed") : t(`err.${code}`);
  };
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString(locale === "en" ? "en-US" : "es-MX", { dateStyle: "medium", timeStyle: "short" }) : t("src.never"));

  function add() {
    setMsg(null);
    start(async () => {
      try {
        const r = await addLinkAction({ url, title: title || undefined });
        if (!r.ok) { setMsg({ tone: "bad", text: t("src.invalidUrl") }); return; }
        setUrl(""); setTitle("");
        setMsg(r.error ? { tone: "bad", text: errText(r.error) } : { tone: "good", text: t("src.added") });
        router.refresh();
      } catch { setMsg({ tone: "bad", text: t("src.failed") }); }
    });
  }

  async function upload(file: File | undefined) {
    if (!file) { setMsg({ tone: "bad", text: t("up.noFile") }); return; }
    setMsg(null); setUploading(true); setFileName(file.name);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/sources/upload", { method: "POST", body: fd });
      const j = (await res.json().catch(() => ({}))) as { error?: string; indexed?: boolean };
      if (!res.ok) setMsg({ tone: "bad", text: j.error === "bad_type" ? t("up.badType") : j.error === "too_big" ? t("up.tooBig") : t("src.failed") });
      else setMsg(j.indexed ? { tone: "good", text: t("src.added") } : { tone: "bad", text: errText(j.error) });
      if (fileRef.current) fileRef.current.value = "";
      router.refresh();
    } catch { setMsg({ tone: "bad", text: t("src.failed") }); }
    finally { setUploading(false); setFileName(""); }
  }

  function sync(id: string) {
    setMsg(null); setBusyId(id);
    start(async () => {
      try {
        const r = await syncSourceAction({ id });
        setMsg(r.ok ? { tone: "good", text: t("src.synced", { n: r.chunks ?? 0 }) } : { tone: "bad", text: errText(r.error) });
        router.refresh();
      } catch { setMsg({ tone: "bad", text: t("src.failed") }); }
      finally { setBusyId(null); }
    });
  }

  function remove(id: string) {
    setToDelete(null);
    setBusyId(id);
    start(async () => {
      try {
        const r = await deleteSourceAction({ id });
        setMsg(r.ok ? { tone: "good", text: t("src.deleted") } : { tone: "bad", text: t("src.failed") });
        router.refresh();
      } catch { setMsg({ tone: "bad", text: t("src.failed") }); }
      finally { setBusyId(null); }
    });
  }

  return (
    <div className="space-y-4">
      {msg && (
        <div role={msg.tone === "bad" ? "alert" : "status"} className={`rounded-xl px-4 py-3 text-sm ${msg.tone === "good" ? "bg-green-100 text-green-900" : "bg-red-100 text-red-900"}`}>{msg.text}</div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <h2 className="mb-3 text-base font-semibold text-ink">{t("src.add.title")}</h2>
          <form className="space-y-3" noValidate onSubmit={(e) => { e.preventDefault(); add(); }}>
            <Field label={t("src.add.url")}>
              <input className={inputCls} type="url" inputMode="url" autoComplete="url" value={url} maxLength={2000} placeholder={t("src.add.urlPh")} onChange={(e) => setUrl(e.target.value)} />
            </Field>
            <Field label={t("src.add.name")}>
              <input className={inputCls} value={title} maxLength={120} placeholder={t("src.add.namePh")} onChange={(e) => setTitle(e.target.value)} />
            </Field>
            <p className="rounded-lg bg-blue-50 px-3 py-2 text-xs text-blue-900">{t("src.google")}</p>
            <Button type="submit" disabled={pending || !url.trim()}>{pending && !busyId ? t("src.add.loading") : t("src.add.btn")}</Button>
          </form>
        </Card>

        <Card>
          <h2 className="mb-1 text-base font-semibold text-ink">{t("src.upload.title")}</h2>
          <p className="mb-3 text-sm text-muted">{t("src.upload.hint")}</p>
          <input
            ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md,.csv,.html" className="sr-only" tabIndex={-1} aria-hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f); }}
          />
          <Button disabled={uploading} onClick={() => fileRef.current?.click()}>{uploading ? t("src.uploading") : t("src.upload.btn")}</Button>
          {uploading && fileName && <p className="mt-2 truncate text-xs text-muted" role="status">{t("src.fileSelected", { name: fileName })}</p>}
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 text-base font-semibold text-ink">{t("src.list")}</h2>
        {sources.length === 0 ? (
          <p className="text-sm text-muted">{t("src.empty")}</p>
        ) : (
          <ul className="divide-y divide-line">
            {sources.map((s) => (
              <li key={s.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate font-medium text-ink">{s.title}</span>
                    <Badge tone="neutral">{t(`src.kind.${s.kind}`)}</Badge>
                    <Badge tone={s.status === "indexed" ? "good" : s.status === "error" ? "bad" : "warn"}>{s.status === "pending" && <Spinner />}{t(`src.status.${s.status}`)}</Badge>
                  </div>
                  {!!s.sections?.length && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {s.sections.map((name) => <Badge key={name} tone="info">{t("src.usedIn", { name })}</Badge>)}
                    </div>
                  )}
                  {s.url && <p className="truncate text-xs text-muted">{s.url}</p>}
                  <p className="text-xs text-muted">{t("src.lastSync", { d: fmt(s.lastSyncedAt) })}</p>
                  {s.status === "error" && s.error && <p className="mt-1 text-xs text-danger">{errText(s.error)}</p>}
                </div>
                <div className="flex shrink-0 gap-2">
                  <Button variant="secondary" title={t("src.sync.hint")} disabled={pending || busyId === s.id} onClick={() => sync(s.id)}>
                    {busyId === s.id && pending ? t("src.syncing") : t("src.sync")}
                  </Button>
                  <Button variant="ghost" className="text-danger" aria-label={`${t("src.delete")}: ${s.title}`} disabled={pending || busyId === s.id} onClick={() => setToDelete(s)}>{t("src.delete")}</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <ConfirmDialog
        open={!!toDelete}
        title={t("src.confirmDelete", { name: toDelete?.title ?? "" })}
        body={t("src.confirmDelete.body")}
        confirmLabel={t("src.confirmDelete.yes")}
        cancelLabel={t("src.cancel")}
        onConfirm={() => toDelete && remove(toDelete.id)}
        onCancel={() => setToDelete(null)}
      />
    </div>
  );
}

function Spinner() {
  return <span aria-hidden className="mr-1.5 inline-block h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />;
}
