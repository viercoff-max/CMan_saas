"use client";
// In-page confirmation (replaces window.confirm) so the item name can be shown. Uses the native <dialog> (focus trap + Esc).
import { useEffect, useRef } from "react";

export function ConfirmDialog({ open, title, body, confirmLabel, cancelLabel, onConfirm, onCancel }: {
  open: boolean; title: string; body?: string; confirmLabel: string; cancelLabel: string; onConfirm: () => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} onClose={onCancel} onCancel={onCancel} aria-labelledby="cd-title"
      className="m-auto w-[min(92vw,26rem)] rounded-2xl border border-line bg-surface p-5 text-ink shadow-xl backdrop:bg-black/50">
      <h2 id="cd-title" className="text-base font-semibold">{title}</h2>
      {body && <p className="mt-2 text-sm text-muted">{body}</p>}
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onCancel} className="min-h-11 rounded-xl border border-line bg-surface px-4 text-sm font-medium text-ink hover:bg-canvas">{cancelLabel}</button>
        <button type="button" onClick={onConfirm} className="min-h-11 rounded-xl bg-danger px-4 text-sm font-medium text-on-danger hover:opacity-90">{confirmLabel}</button>
      </div>
    </dialog>
  );
}
