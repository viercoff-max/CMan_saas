// Row <-> domain mappers, error mapping and small query helpers for the Supabase DataStore.
// Differences from SQLite handled here: uuid ids, timestamptz (ISO with offset) vs ISO-Z strings, jsonb columns,
// epoch-ms limiter times stored as timestamptz, provider_message_id / external_id / storage_path / legal_hold columns.
import type {
  Addon, AgentSettings, Channel, ChannelAccount, Chunk, Conversation, ConversationStatus, Message, Sender, Source,
  SourceKind, SourceStatus,
} from "../../types";
import { DataBackendError, DataConflictError, DataValidationError } from "../errors";
import type {
  BrandSettings, CustomerConversation, MemberRole, SectionMode, SectionRow, TenantInfo, TenantOverview, TenantPlan, TenantStatus, UsageRow,
} from "../types";
import type { DbError, DbResult, Query, Row } from "./client";

// ---------------------------------------------------------------- errors
export const UQ_CHANNEL_EXTERNAL = "uq_channel_external";
export const UQ_MSG_PROVIDER = "uq_msg_provider";

/** Constraint name from a Postgres error message (`... constraint "name"`), or "". */
export const constraintOf = (e: DbError): string => /constraint "([^"]+)"/.exec(e.message ?? "")?.[1] ?? "";
export const isUniqueViolation = (e: DbError | null | undefined, constraint?: string): boolean =>
  !!e && e.code === "23505" && (!constraint || constraintOf(e) === constraint);

/**
 * Postgres / PostgREST error -> backend-neutral error. Never copies `details`/`hint`/values into the message:
 * they can contain customer data (e.g. "Key (channel, external_id)=(whatsapp, 5215...)").
 */
export function mapDbError(e: DbError, ctx: string): Error {
  const code = e.code ?? "";
  const constraint = constraintOf(e);
  if (code === "23505") return new DataConflictError(constraint === UQ_CHANNEL_EXTERNAL ? "channel_in_use" : constraint || "conflict");
  if (code === "23514" || code === "23502" || code === "22001" || code === "22P02" || code === "22007" || code === "22003")
    return new DataValidationError(constraint || ctx);
  if (code === "23503") return new DataValidationError(constraint || "reference");
  return new DataBackendError(`Supabase ${ctx} failed (code ${code || "unknown"}${constraint ? `, ${constraint}` : ""}).`, code);
}

/** Awaits a query; throws the mapped error. */
export async function run(q: PromiseLike<DbResult>, ctx: string): Promise<DbResult> {
  const r = await q;
  if (r.error) throw mapDbError(r.error, ctx);
  return r;
}
export async function rows(q: PromiseLike<DbResult>, ctx: string): Promise<Row[]> {
  const r = await run(q, ctx);
  return Array.isArray(r.data) ? (r.data as Row[]) : [];
}
export async function one(q: PromiseLike<DbResult>, ctx: string): Promise<Row | null> {
  const r = await run(q, ctx);
  return r.data && typeof r.data === "object" && !Array.isArray(r.data) ? (r.data as Row) : null;
}
export async function count(q: PromiseLike<DbResult>, ctx: string): Promise<number> {
  return Number((await run(q, ctx)).count ?? 0);
}

/** PostgREST caps responses (max-rows, 1000 by default): read everything in stable pages. */
export const PAGE = 1000;
export async function allRows(make: () => Query, ctx: string, page = PAGE): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; ; from += page) {
    const batch = await rows(make().range(from, from + page - 1), ctx);
    out.push(...batch);
    if (batch.length < page) return out;
  }
}

// ---------------------------------------------------------------- scalars
/** timestamptz (any offset) -> ISO-8601 UTC "…Z" like the rest of the app; null stays null. */
export function iso(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? String(v) : d.toISOString();
}
export const isoOr = (v: unknown, fallback = ""): string => iso(v) ?? fallback;
/** Epoch ms (limiter API) -> timestamptz literal. */
export const msToIso = (ms: number): string => new Date(Number(ms)).toISOString();
/** jsonb object column -> a fresh object ({} for null / non-objects). Never returns the row's own object. */
export const obj = (v: unknown): Record<string, unknown> => {
  if (typeof v === "string") { try { v = JSON.parse(v); } catch { return {}; } }
  return v && typeof v === "object" && !Array.isArray(v) ? { ...(v as Record<string, unknown>) } : {};
};
/** Escapes LIKE wildcards so user text matches literally. */
export const escapeLike = (s: string): string => s.replace(/[\\%_]/g, (c) => `\\${c}`);
/** Truncates to a column's CHECK length (audit/details text must never make a business write fail). */
export const cap = (s: unknown, n: number): string => String(s ?? "").slice(0, n);

// ---------------------------------------------------------------- settings / brand
/** agent_settings.business_hours is jsonb; the domain keeps it as a string ("{}" or JSON or free text). */
export function businessHoursToDb(s: string): unknown {
  try {
    const v = JSON.parse(s);
    if (v && typeof v === "object") return v;
  } catch { /* free text */ }
  return s;
}
export const businessHoursFromDb = (v: unknown): string =>
  v === null || v === undefined ? "{}" : typeof v === "string" ? v : JSON.stringify(v);

export function mapSettings(r: Row): AgentSettings {
  return {
    tenantId: r.tenant_id as string, agentName: String(r.agent_name ?? ""),
    toneLevel: Number(r.tone_level) as AgentSettings["toneLevel"],
    languageDefault: r.language_default as AgentSettings["languageDefault"],
    languageAlt: r.language_alt as AgentSettings["languageAlt"],
    greeting: String(r.greeting ?? ""), fallbackMessage: String(r.fallback_message ?? ""),
    handoffEmail: String(r.handoff_email ?? ""), businessHours: businessHoursFromDb(r.business_hours),
    crossSellLevel: Number(r.cross_sell_level) as AgentSettings["crossSellLevel"], botEnabled: !!r.bot_enabled,
  };
}
export function settingsToDb(n: AgentSettings): Row {
  return {
    agent_name: n.agentName, tone_level: n.toneLevel, language_default: n.languageDefault, language_alt: n.languageAlt,
    greeting: n.greeting, fallback_message: n.fallbackMessage, handoff_email: n.handoffEmail,
    business_hours: businessHoursToDb(n.businessHours), cross_sell_level: n.crossSellLevel, bot_enabled: !!n.botEnabled,
  };
}
export function mapBrand(tenantId: string, r: Row): BrandSettings {
  return {
    tenantId, displayName: String(r.display_name ?? ""), logoPath: (r.logo_path as string) ?? null,
    primaryColor: r.primary_color as string, accentColor: r.accent_color as string, menuBgColor: r.menu_bg_color as string,
    headingFont: r.heading_font as string, updatedAt: iso(r.updated_at),
  };
}

// ---------------------------------------------------------------- tenants
export const TENANT_COLUMNS = "id, name, slug, plan, status, ai_monthly_token_cap, created_at";
const PLANS: readonly string[] = ["free", "pro", "business"];
const STATUSES: readonly string[] = ["active", "suspended", "deleted"];
export function mapTenant(r: Row): TenantInfo {
  return {
    id: r.id as string, name: String(r.name ?? ""), slug: String(r.slug ?? ""),
    plan: (PLANS.includes(String(r.plan)) ? r.plan : "free") as TenantPlan,
    status: (STATUSES.includes(String(r.status)) ? r.status : "active") as TenantStatus,
    aiMonthlyTokenCap: Number(r.ai_monthly_token_cap ?? 0), createdAt: isoOr(r.created_at),
  };
}
export function mapTenantOverview(r: Row): TenantOverview {
  return {
    ...mapTenant(r), members: Number(r.members ?? 0), conversationsThisMonth: Number(r.conversations_this_month ?? 0),
    connectedChannels: Number(r.connected_channels ?? 0), aiTokensThisMonth: Number(r.ai_tokens_this_month ?? 0),
  };
}

// ---------------------------------------------------------------- people
export const mapRole = (r: unknown): MemberRole => (r === "owner" || r === "agent" ? r : "admin");
export const userName = (meta: Record<string, unknown> | null | undefined): string =>
  String(meta?.name ?? meta?.full_name ?? "");

// ---------------------------------------------------------------- knowledge
export function mapSource(r: Row): Source {
  return {
    id: r.id as string, tenantId: r.tenant_id as string, kind: r.kind as SourceKind, title: String(r.title ?? ""),
    url: (r.url as string) ?? null, filePath: (r.storage_path as string) ?? null, status: r.status as SourceStatus,
    error: (r.error as string) ?? null, lastSyncedAt: iso(r.last_synced_at), createdAt: isoOr(r.created_at),
  };
}
export function mapSectionRow(r: Row): SectionRow {
  return {
    key: r.key as SectionRow["key"], content: String(r.content ?? ""), mode: (r.mode === "file" ? "file" : "text") as SectionMode,
    fileSourceId: (r.file_source_id as string) ?? null, updatedAt: isoOr(r.updated_at),
  };
}
export const mapChunk = (r: Row): Chunk => ({
  id: r.id as string, tenantId: r.tenant_id as string, sourceId: (r.source_id as string) ?? null,
  sectionKey: (r.section_key as string) ?? null, title: String(r.title ?? ""), text: String(r.text ?? ""),
});

// ---------------------------------------------------------------- inbox
export function mapConversation(r: Row): Conversation {
  return {
    id: r.id as string, tenantId: r.tenant_id as string, channel: r.channel as Channel, externalId: String(r.external_id ?? ""),
    customerName: String(r.customer_name ?? ""), status: r.status as ConversationStatus,
    escalationReason: (r.escalation_reason as string) ?? null, state: obj(r.state),
    lastMessageAt: isoOr(r.last_message_at), unread: Number(r.unread ?? 0), createdAt: isoOr(r.created_at),
  };
}
export function mapMessage(r: Row): Message {
  const meta = obj(r.meta);
  const pmid = (r.provider_message_id as string) ?? (typeof meta.providerMessageId === "string" ? meta.providerMessageId : null);
  return {
    id: r.id as string, conversationId: r.conversation_id as string, tenantId: r.tenant_id as string,
    direction: r.direction as "in" | "out", sender: r.sender as Sender, body: String(r.body ?? ""),
    meta, providerMessageId: pmid ?? null, createdAt: isoOr(r.created_at),
  };
}
/** The legal_hold column is surfaced as state.legalHold so lib/retention's hold check sees it. */
export function mapCustomerConversation(r: Row): CustomerConversation {
  const state = obj(r.state);
  if (r.legal_hold === true) state.legalHold = true;
  return {
    id: r.id as string, channel: String(r.channel ?? ""), externalId: String(r.external_id ?? ""), customerName: String(r.customer_name ?? ""),
    status: String(r.status ?? ""), escalationReason: (r.escalation_reason as string) ?? null, state: JSON.stringify(state),
    createdAt: isoOr(r.created_at), lastMessageAt: isoOr(r.last_message_at),
  };
}

// ---------------------------------------------------------------- integrations
export function mapAddon(key: Addon["key"], r: Row | null): Addon {
  return { key, status: (r?.status as Addon["status"]) ?? "disconnected", publicInfo: obj(r?.public_info), connectedAt: iso(r?.connected_at) };
}
export function mapChannel(channel: ChannelAccount["channel"], r: Row | null): ChannelAccount {
  return {
    channel, status: (r?.status as ChannelAccount["status"]) ?? "disconnected", publicInfo: obj(r?.public_info),
    webhookId: (r?.webhook_id as string) ?? null,
  };
}
/** channel_accounts.external_id (routing + uq_channel_external) comes from publicInfo.externalId. */
export function externalIdOf(publicInfo: Record<string, unknown> | undefined): string | null {
  const v = publicInfo?.externalId;
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim();
  return s ? s.slice(0, 200) : null;
}

// ---------------------------------------------------------------- usage
export function mapUsage(tenantId: string, period: string, r: Row | null): UsageRow {
  return { tenantId, period, requests: Number(r?.requests ?? 0), inputTokens: Number(r?.input_tokens ?? 0), outputTokens: Number(r?.output_tokens ?? 0) };
}
