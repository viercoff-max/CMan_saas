// Centered card used by every signed-out screen (login, sign-up, password reset, invitation, onboarding).
import type { ReactNode } from "react";
import { Card } from "@/components/ui";

export function AuthCard({ title, subtitle, eyebrow, children, wide }: { title: string; subtitle?: string; eyebrow?: string; children: ReactNode; wide?: boolean }) {
  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <Card className={`w-full ${wide ? "max-w-md" : "max-w-sm"}`}>
        {eyebrow && <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">{eyebrow}</p>}
        <h1 className="text-xl font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted">{subtitle}</p>}
        <div className="mt-4">{children}</div>
      </Card>
    </main>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "error"; children: ReactNode }) {
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`mb-4 rounded-xl px-3 py-2 text-sm ${tone === "error" ? "bg-danger/10 text-danger" : "bg-canvas text-ink"}`}>
      {children}
    </div>
  );
}

export const linkCls = "font-medium text-brand underline underline-offset-2 hover:text-brand-dark";
