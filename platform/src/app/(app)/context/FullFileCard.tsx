"use client";
// "Opción rápida" at the top of /context: ONE file with everything the assistant should know, for owners who do not
// want to fill the sections one by one. It is a general Data source (POST /api/sources/upload): the assistant finds
// the relevant parts of it for each question. Removing it uses the same action as the Data sources screen.
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Badge, Button, Card, ConfirmDialog } from "@/components/ui";
import { useT } from "@/lib/i18n-client";
import { dict } from "@/lib/context/dict";
import { deleteSourceAction } from "../sources/actions";

type Status = "pending" | "indexed" | "error";
export interface FullFileInfo { id: string; name: string; status: Status; error: string | null }
type Msg = { tone: "good" | "bad"; text: string } | null;

export function FullFileCard({ files }: { files: FullFileInfo[] }) {
  const t = useT(dict);
  const router = useRouter();
  const ref = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<Msg>(null);
  const [toRemove, setToRemove] = useState<FullFileInfo | null>(null);
  const [pending, start] = useTransition();
  const ready = files.some((f) => f.status === "indexed");

  const errText = (code: string | null | undefined) => {
    if (code === "bad_type") return t("up.badType");
    if (code === "too_big") return t("up.tooBig");
    if (code && t(`err.${code}`) !== `err.${code}`) return t(`err.${code}`);
    return t("src.failed");
  };

  async function upload(file: File | undefined) {
    if (!file) return;
    setMsg(null); setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/sources/upload", { method: "POST", body: fd });
      const j = (await res.json().catch(() => ({}))) as { error?: string; indexed?: boolean };
      if (!res.ok) setMsg({ tone: "bad", text: errText(j.error) });
      else setMsg(j.indexed ? { tone: "good", text: t("full.uploaded") } : { tone: "bad", text: t("full.readFailed", { reason: errText(j.error) }) });
      router.refresh();
    } catch { setMsg({ tone: "bad", text: t("src.failed") }); }
    finally { setUploading(false); if (ref.current) ref.current.value = ""; }
  }

  function remove(f: FullFileInfo) {
    setToRemove(null);
    start(async () => {
      try {
        const r = await deleteSourceAction({ id: f.id });
        setMsg(r.ok ? { tone: "good", text: t("full.removed") } : { tone: "bad", text: t("src.failed") });
        router.refresh();
      } catch { setMsg({ tone: "bad", text: t("src.failed") }); }
    });
  }

  return (
    <Card className="mb-4 border-2 border-brand/40">
      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold text-ink">{t("full.title")}</h2>
        <Badge tone={ready ? "good" : "info"}>{ready ? t("full.active") : t("full.recommended")}</Badge>
      </div>
      <p className="mb-3 text-sm text-muted">{t("full.hint")}</p>
      <input ref={ref} type="file" accept=".pdf,.docx,.txt,.md,.csv,.html" className="sr-only" tabIndex={-1} aria-hidden
        onChange={(e) => void upload(e.target.files?.[0])} />

      {files.length > 0 && (
        <ul className="mb-3 divide-y divide-line rounded-xl border border-line" data-testid="full-files">
          {files.map((f) => (
            <li key={f.id} className="flex flex-col gap-2 px-4 py-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="truncate text-sm font-medium text-ink">{f.name}</span>
                <Badge tone={f.status === "indexed" ? "good" : f.status === "error" ? "bad" : "warn"}>{t(`src.status.${f.status}`)}</Badge>
                {f.status === "error" && <span className="text-xs text-danger">{errText(f.error)}</span>}
              </div>
              <Button type="button" variant="ghost" className="text-danger" disabled={pending || uploading}
                aria-label={`${t("ctx.file.remove")}: ${f.name}`} onClick={() => setToRemove(f)}>{t("ctx.file.remove")}</Button>
            </li>
          ))}
        </ul>
      )}

      <Button type="button" size="lg" disabled={uploading || pending} onClick={() => ref.current?.click()}>
        {uploading ? t("ctx.file.uploading") : files.length ? t("full.addAnother") : t("full.choose")}
      </Button>
      <p className="mt-2 text-xs text-muted">{t("full.formats")}</p>
      {ready && <p className="mt-3 rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-900">{t("full.note")}</p>}

      <p className="mt-2 min-h-5 text-sm" role="status" aria-live="polite">
        {msg && <span className={msg.tone === "good" ? "text-ok" : "text-danger"}>{msg.text}</span>}
      </p>

      <ConfirmDialog
        open={!!toRemove}
        title={t("ctx.file.confirmRemove", { name: toRemove?.name ?? "" })}
        body={t("full.confirmRemove.body")}
        confirmLabel={t("ctx.file.confirmRemove.yes")}
        cancelLabel={t("src.cancel")}
        onConfirm={() => toRemove && remove(toRemove)}
        onCancel={() => setToRemove(null)}
      />
    </Card>
  );
}
