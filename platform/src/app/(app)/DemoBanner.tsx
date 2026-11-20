"use client";
// Shown on every app page of a demo business ("Crear negocio demo"). The owner can delete the whole demo here.
import { useActionState, useRef, useState } from "react";
import { Button, ConfirmDialog } from "@/components/ui";
import { useT } from "@/lib/i18n-client";
import { shellDict } from "@/lib/shell-dict";
import { deleteDemoBusinessAction, type DeleteDemoState } from "../onboarding/demo/actions";

export function DemoBanner({ canDelete }: { canDelete: boolean }) {
  const t = useT(shellDict);
  const [state, action, pending] = useActionState<DeleteDemoState, FormData>(deleteDemoBusinessAction, {});
  const [confirm, setConfirm] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);
  return (
    <div className="mb-4 flex flex-col gap-2 rounded-xl border border-[var(--warn,#b45309)]/40 bg-[var(--warn-bg,#fffbeb)] p-3 text-sm text-ink sm:flex-row sm:items-center sm:justify-between" data-testid="demo-banner">
      <p>{t("demo.banner")}</p>
      {canDelete && (
        <form ref={formRef} action={action}>
          <Button type="button" variant="ghost" className="min-h-11 text-danger" disabled={pending} onClick={() => setConfirm(true)}>
            {pending ? t("demo.deleting") : t("demo.delete")}
          </Button>
        </form>
      )}
      {state.error && <p role="alert" className="text-sm text-danger">{t(`demo.err.${state.error}`)}</p>}
      <ConfirmDialog open={confirm} title={t("demo.confirmTitle")} body={t("demo.confirmBody")} confirmLabel={t("demo.delete")} cancelLabel={t("demo.cancel")}
        onConfirm={() => { setConfirm(false); formRef.current?.requestSubmit(); }} onCancel={() => setConfirm(false)} />
    </div>
  );
}
