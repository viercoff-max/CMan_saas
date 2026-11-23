"use client";
// In-app side of the notices (phase 2): when the service worker receives a push it posts the notice to every open
// Conversa window. Here we show it as a message in the corner (with "Ver") and refresh the server-rendered counters
// (sidebar badge, dashboard). While the page is visible we also refresh every minute so counters stay current even
// without notices turned on. Only local paths are ever linked.
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useT } from "@/lib/i18n-client";
import { shellDict } from "@/lib/shell-dict";

type Notice = { title: string; body: string; url: string; kind: string; id?: string };
const REFRESH_MS = 60_000;
const SHOW_MS = 12_000;

export function NoticeListener() {
  const t = useT(shellDict);
  const router = useRouter();
  const [notices, setNotices] = useState<(Notice & { key: number })[]>([]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const onMessage = (e: MessageEvent) => {
      const d = e.data as { type?: string; notice?: Notice } | null;
      if (!d || d.type !== "conversa-notice" || !d.notice) return;
      const n = d.notice;
      const url = typeof n.url === "string" && n.url.startsWith("/") && !n.url.startsWith("//") ? n.url : "/inbox";
      const key = Date.now() + Math.random();
      setNotices((xs) => [...xs.slice(-2), { ...n, url, key }]);
      setTimeout(() => setNotices((xs) => xs.filter((x) => x.key !== key)), n.kind === "urgent" ? SHOW_MS * 3 : SHOW_MS);
      router.refresh(); // badge + dashboard counters
    };
    navigator.serviceWorker.addEventListener("message", onMessage);
    return () => navigator.serviceWorker.removeEventListener("message", onMessage);
  }, [router]);

  useEffect(() => {
    const i = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, REFRESH_MS);
    return () => clearInterval(i);
  }, [router]);

  if (!notices.length) return null;
  return (
    <div className="fixed bottom-4 right-4 z-50 flex w-[min(92vw,360px)] flex-col gap-2" role="status" aria-live="polite" data-testid="notice-toasts">
      {notices.map((n) => (
        <div key={n.key} className={`rounded-2xl border bg-surface p-4 shadow-lg ${n.kind === "urgent" ? "border-l-4 border-red-600" : "border-line"}`}>
          <p className="text-sm font-semibold text-ink">{n.kind === "urgent" && <span aria-hidden>⚠ </span>}{n.title}</p>
          {n.body && <p className="mt-0.5 text-sm text-muted">{n.body}</p>}
          <div className="mt-2 flex gap-3">
            <Link href={n.url} className="inline-flex min-h-10 items-center rounded-xl bg-brand px-3 text-sm font-medium text-on-brand"
              onClick={() => setNotices((xs) => xs.filter((x) => x.key !== n.key))}>{t("notice.view")}</Link>
            <button type="button" className="min-h-10 px-2 text-sm text-muted hover:text-ink" onClick={() => setNotices((xs) => xs.filter((x) => x.key !== n.key))}>{t("notice.close")}</button>
          </div>
        </div>
      ))}
    </div>
  );
}
