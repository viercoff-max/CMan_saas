"use client";
// Small shared presentational pieces for the inbox.
import { Badge } from "@/components/ui";
import type { Channel, ConversationStatus } from "@/lib/types";

const PLATFORM: Record<Channel, { label: string; cls: string }> = {
  whatsapp: { label: "WA", cls: "bg-green-700 text-white" },
  instagram: { label: "IG", cls: "bg-pink-700 text-white" },
  messenger: { label: "MS", cls: "bg-blue-700 text-white" },
  simulator: { label: "SIM", cls: "bg-slate-600 text-white" },
};
export function PlatformIcon({ channel, name }: { channel: Channel; name?: string }) {
  const p = PLATFORM[channel];
  return <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${p.cls}`}><span aria-hidden>{p.label}</span>{name && <span className="sr-only">{name}</span>}</span>;
}

const TONE: Record<ConversationStatus, "bad" | "info" | "warn" | "good"> = { needs_human: "bad", bot: "info", human: "warn", resolved: "good" };
export function StatusBadge({ status, label }: { status: ConversationStatus; label: string }) {
  return <Badge tone={TONE[status]}>{label}</Badge>;
}

export function relTime(iso: string, t: (k: string, v?: Record<string, string | number>) => string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const m = Math.floor(diff / 60000);
  if (m < 1) return t("now");
  if (m < 60) return t("min", { n: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("hr", { n: h });
  return t("day", { n: Math.floor(h / 24) });
}
