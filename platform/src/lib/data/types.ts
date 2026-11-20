// The ONE data-access contract of the app. Every backend (SQLite today, Supabase next) implements DataStore.
// Rules (AGENTS.md):
//   * Every method that touches tenant-owned data takes `tenantId` explicitly and never reads/writes other tenants.
//     The few cross-tenant lookups (webhook routing, Meta deletion callback, retention job, login) are named as such.
//   * Secrets (channel / add-on tokens) are only reachable through `secrets`. Nothing else returns them, so UI code
//     that reads addons/channels can never leak a token.
//   * Every method is async so a network backend can implement it without touching callers.
// NOTE: relative, type-only imports here (the CLI scripts load src/lib with Node's type stripping).
import type {
  AddonKey, Addon, AgentSettings, Channel, ChannelAccount, Chunk, ContextSection, ContextSectionKey, Conversation,
  ConversationStatus, Message, Sender, Source, SourceKind, SourceStatus,
} from "../types";

export type DataBackend = "sqlite" | "supabase";

/**
 * Pseudo tenant id for audit rows that belong to no tenant (failed sign-in of an unknown email, platform events).
 * SQLite stores it as the tenant_id text; Supabase stores tenant_id NULL (only the service role can read those rows).
 */
export const AUDIT_GLOBAL_TENANT = "system";

// ---------------- tenants / members / users ----------------
export type TenantPlan = "free" | "pro" | "business";
export type TenantStatus = "active" | "suspended" | "deleted";
/** Public tenant record (Supabase: public.tenants; SQLite: tenants, where slug falls back to the id). */
export interface TenantInfo {
  id: string; name: string; slug: string; plan: TenantPlan; status: TenantStatus;
  /** Monthly AI token budget (input + output tokens). */
  aiMonthlyTokenCap: number;
  createdAt: string;
}
/** One row of the platform-admin tenant list: the tenant plus this month's counts. */
export interface TenantOverview extends TenantInfo {
  members: number;
  /** Real-customer conversations (simulator excluded) with a message since the first day of the month (UTC). */
  conversationsThisMonth: number;
  connectedChannels: number;
  /** input + output tokens of the month (ai_usage). */
  aiTokensThisMonth: number;
}
export interface TenantListQuery {
  /** Page size, clamped to 1..200 (default 50). */
  limit?: number;
  /** Rows to skip (default 0). */
  offset?: number;
  /** Case-insensitive substring of the name or slug (LIKE wildcards are literal). Max 100 chars. */
  search?: string;
  /** Picks the month of the counts (default: now). */
  now?: Date;
}
export interface TenantListPage {
  items: TenantOverview[];
  /** Tenants matching `search` (all pages). */
  total: number;
  /** "YYYY-MM-01" of the counted month. */
  period: string;
}
export interface TenantsRepo {
  get(tenantId: string): Promise<TenantInfo | null>;
  /**
   * L1 (REVIEW-security-2): false for suspended / deleted tenants. Webhook routing, the AI budget and session
   * resolution use it so a suspended tenant gets no bot replies, no AI spend and no app access.
   * Supabase: false for unknown / malformed ids (fail closed). SQLite (on-prem): a tenant without a tenants row
   * (single-tenant databases from older builds) counts as active.
   */
  isActive(tenantId: string): Promise<boolean>;
  /**
   * CROSS-TENANT by design (platform-admin screen only). The CALLER must first check
   * `platformAdmins.isPlatformAdmin(session.userId)`; this method does not know who is asking.
   * Newest tenants first. Supabase: one RPC (platform_tenant_overview, service_role only); SQLite: one query.
   */
  listAll(q?: TenantListQuery): Promise<TenantListPage>;
  /**
   * Bootstrap only (first-run seed, local demo, tests). Creates the tenant when missing and returns ITS id:
   * SQLite uses `tenantIdOrSlug` as the (text) id; Supabase treats it as the tenant slug (or an existing uuid) and
   * returns the uuid. Callers must use the returned id. Real Supabase sign-ups use the create_tenant RPC instead.
   */
  ensure(tenantIdOrSlug: string, name: string): Promise<string>;
}
export type MemberRole = "owner" | "admin" | "agent";
export interface Member { userId: string; tenantId: string; name: string; email: string; role: MemberRole }
/** Read-only for now (stage 3 adds invitations / role changes with Supabase Auth). Supabase: tenant_members + auth users. */
export interface MembersRepo {
  list(tenantId: string): Promise<Member[]>;
}
/**
 * Local credential store used by lib/auth.ts until Supabase Auth replaces it (stage 3). Server-only: the password
 * hash is returned only by `findLoginByEmail` and must never reach UI code.
 */
export interface UserLogin { id: string; tenantId: string; passwordHash: string }
export interface UserProfile { id: string; tenantId: string; name: string; email: string }
export interface UsersRepo {
  count(): Promise<number>;
  findLoginByEmail(email: string): Promise<UserLogin | null>;
  get(userId: string): Promise<UserProfile | null>;
  create(u: { id?: string; tenantId: string; email: string; name: string; passwordHash: string; role?: MemberRole }): Promise<string>;
  setPasswordHash(userId: string, passwordHash: string): Promise<boolean>;
}

/**
 * Platform operators (not tenant members). Supabase: public.platform_admins (rows added by the owner in SQL).
 * SQLite: no table; the comma-separated env PLATFORM_ADMIN_EMAILS is matched against the local user's email.
 */
export interface PlatformAdminsRepo {
  /** CROSS-TENANT (global role). False for unknown / malformed ids. */
  isPlatformAdmin(userId: string): Promise<boolean>;
}

// ---------------- settings / brand ----------------
export type SettingsPatch = Partial<Omit<AgentSettings, "tenantId">>;
export interface SettingsRepo {
  /** Creates the default row on first read. */
  get(tenantId: string): Promise<AgentSettings>;
  /** Clamps toneLevel 1..5 and crossSellLevel 0..3. Returns the stored row. */
  save(tenantId: string, patch: SettingsPatch): Promise<AgentSettings>;
  /** True once the Tone screen was saved at least once. */
  isToneSaved(tenantId: string): Promise<boolean>;
  /** Records that the Tone screen was saved (SQLite: the "settings.save"/"tone" audit marker; Supabase: tone_saved_at). */
  markToneSaved(tenantId: string, actor: string): Promise<void>;
}
export interface BrandSettings {
  tenantId: string; displayName: string; logoPath: string | null;
  primaryColor: string; accentColor: string; menuBgColor: string; headingFont: string; updatedAt: string | null;
}
export type BrandPatch = Partial<Omit<BrandSettings, "tenantId" | "updatedAt">>;
export interface BrandRepo {
  /** Defaults (same as the Supabase column defaults) when nothing was saved yet. */
  get(tenantId: string): Promise<BrandSettings>;
  /** Validates like the Supabase CHECK constraints (hex colours, font name, lengths); throws DataValidationError. */
  save(tenantId: string, patch: BrandPatch): Promise<BrandSettings>;
}

// ---------------- knowledge ----------------
export type SectionMode = "text" | "file";
export interface SectionRow { key: ContextSectionKey; content: string; mode: SectionMode; fileSourceId: string | null; updatedAt: string }
export interface SectionsRepo {
  /** Every section key, with "" / text mode for sections never saved. */
  list(tenantId: string): Promise<ContextSection[]>;
  /** Content + mode + file of every section key. */
  listRows(tenantId: string): Promise<SectionRow[]>;
  getRow(tenantId: string, key: ContextSectionKey): Promise<SectionRow | null>;
  saveContent(tenantId: string, key: ContextSectionKey, content: string): Promise<void>;
  setMode(tenantId: string, key: ContextSectionKey, mode: SectionMode): Promise<void>;
  setFile(tenantId: string, key: ContextSectionKey, sourceId: string | null): Promise<void>;
  /** Linked Data sources (only links whose source still exists), oldest first. */
  listLinks(tenantId: string): Promise<{ sectionKey: ContextSectionKey; sourceId: string }[]>;
  /** False when the source is not this tenant's (cross-tenant ids are refused). */
  link(tenantId: string, key: ContextSectionKey, sourceId: string): Promise<boolean>;
  unlink(tenantId: string, key: ContextSectionKey, sourceId: string): Promise<void>;
  /** Sections that use the source as linked source or as their file. */
  sectionsForSource(tenantId: string, sourceId: string): Promise<ContextSectionKey[]>;
  /** Drops every link to the source and clears it as section file (mode back to text). Returns the sections touched. */
  removeSourceReferences(tenantId: string, sourceId: string): Promise<ContextSectionKey[]>;
}
export interface SourceText {
  id: string; kind: SourceKind; title: string; url: string | null; filePath: string | null;
  status: SourceStatus; error: string | null; text: string;
}
export interface SourcesRepo {
  list(tenantId: string): Promise<Source[]>;
  get(tenantId: string, id: string): Promise<Source | null>;
  /** The source plus its extracted text (content_text). */
  getText(tenantId: string, id: string): Promise<SourceText | null>;
  exists(tenantId: string, id: string): Promise<boolean>;
  create(tenantId: string, s: { kind: SourceKind; title: string; url?: string; filePath?: string }): Promise<Source>;
  /** `contentText` undefined keeps the stored text. */
  updateStatus(tenantId: string, id: string, status: SourceStatus, error?: string, contentText?: string): Promise<void>;
  /** Deletes the row and its chunks. */
  delete(tenantId: string, id: string): Promise<void>;
}
export interface ChunkInput { title?: string; text: string }
export interface SectionChunkInput { sourceId: string | null; title: string; text: string }
export interface ChunksRepo {
  list(tenantId: string): Promise<Chunk[]>;
  /** Replace all chunks of a source (sourceId) or of a context section (sectionKey). */
  replace(tenantId: string, owner: { sourceId?: string; sectionKey?: string }, chunks: ChunkInput[]): Promise<void>;
  /** Replace every chunk tagged with the section (own text/file + linked sources, each with its sourceId). */
  replaceSection(tenantId: string, key: ContextSectionKey, chunks: SectionChunkInput[]): Promise<void>;
  /** Drop the general (section-less) chunks of a source. */
  deleteGeneralForSource(tenantId: string, sourceId: string): Promise<void>;
}

// ---------------- inbox ----------------
export interface ConversationFilter { channel?: Channel; status?: ConversationStatus; search?: string; limit?: number }
export interface ConversationsRepo {
  getOrCreate(tenantId: string, channel: Channel, externalId: string, customerName?: string): Promise<Conversation>;
  get(tenantId: string, id: string): Promise<Conversation | null>;
  list(tenantId: string, f?: ConversationFilter): Promise<Conversation[]>;
  /** `reason` null/undefined keeps the stored escalation reason. */
  setStatus(tenantId: string, id: string, status: ConversationStatus, reason?: string | null): Promise<void>;
  setState(tenantId: string, id: string, state: Record<string, unknown>): Promise<void>;
  markRead(tenantId: string, id: string): Promise<void>;
  /** Real customers only (simulator excluded). */
  countByStatus(tenantId: string): Promise<Record<ConversationStatus, number>>;
  /**
   * "Return to bot" / "resolve": clears escalation_reason and resets the engine's per-episode counters
   * (offer, misses, botTurns, capOffered). The order lock in state is kept on purpose.
   */
  resetForBot(tenantId: string, id: string): Promise<void>;
  /** Deletes the conversation and its messages. Returns the number of messages deleted (0 when not found). */
  delete(tenantId: string, id: string): Promise<{ conversations: number; messages: number }>;
  findIdByExternal(tenantId: string, channel: Channel, externalId: string): Promise<string | null>;
  listIdsByExternalPrefix(tenantId: string, prefix: string): Promise<string[]>;
  /** Backfill timestamps/unread (demo seed). */
  setTimestamps(tenantId: string, id: string, v: { unread?: number; createdAt?: string; lastMessageAt?: string }): Promise<void>;
}
export interface NewMessage {
  direction: "in" | "out"; sender: Sender; body: string; meta?: Record<string, unknown>;
  /** Channel message id used for inbound dedupe (Supabase column provider_message_id; SQLite meta.providerMessageId). */
  providerMessageId?: string;
}
export interface RecentMessage { sender: string; body: string; intent: string | null }
export interface MessagesRepo {
  /** Stores the message and bumps the conversation's last_message_at (+ unread for inbound). */
  add(tenantId: string, conversationId: string, m: NewMessage): Promise<Message>;
  /** Oldest first. */
  list(tenantId: string, conversationId: string, limit?: number): Promise<Message[]>;
  /** Last `n` messages, oldest first. */
  recent(tenantId: string, conversationId: string, n: number): Promise<RecentMessage[]>;
  /** Latest message (body + sender) of each conversation, for the inbox list. */
  latest(tenantId: string, conversationIds: string[]): Promise<Map<string, { body: string; sender: string }>>;
  lastInboundAt(tenantId: string, conversationId: string): Promise<string | null>;
  /** Inbound dedupe: an inbound message with this provider id is already stored in the conversation. */
  hasProviderMessage(tenantId: string, conversationId: string, providerMessageId: string): Promise<boolean>;
  setCreatedAt(tenantId: string, messageId: string, at: string): Promise<void>;
}

// ---------------- add-ons, channels, secrets ----------------
export interface AddonsRepo {
  get(tenantId: string, key: AddonKey): Promise<Addon>;
  /** Upsert status + publicInfo (connectedAt = now when connected). Disconnecting ALSO wipes the add-on's secrets. */
  save(tenantId: string, key: AddonKey, v: { status: Addon["status"]; publicInfo?: Record<string, unknown> }): Promise<void>;
}
export type ChannelAccountKey = ChannelAccount["channel"];
export interface ChannelsRepo {
  get(tenantId: string, channel: ChannelAccountKey): Promise<ChannelAccount>;
  /**
   * Upsert status + publicInfo. Secrets are untouched (use `secrets`). Throws DataConflictError when another tenant
   * already has the same external id CONNECTED (one Page / number / bot belongs to one tenant).
   */
  save(tenantId: string, channel: ChannelAccountKey, v: { status: ChannelAccount["status"]; publicInfo?: Record<string, unknown> }): Promise<void>;
  /** CROSS-TENANT by design (webhook routing): which ACTIVE tenant has this external id connected (L1: null otherwise). */
  findTenantByExternalId(channel: ChannelAccountKey, externalId: string): Promise<string | null>;
  /**
   * CROSS-TENANT by design (Telegram webhook routing: /api/webhooks/telegram/<webhookId>). The webhookId is the
   * public random id of the channel row (`ChannelAccount.webhookId`, a uuid). Only CONNECTED accounts of ACTIVE
   * tenants match; anything else (unknown, malformed, other channel, disconnected, suspended tenant) is null. It is NOT a secret: the route must
   * still check the Telegram secret header against the encrypted secret (lib/channels/telegram-secret.ts).
   */
  findByWebhookId(channel: ChannelAccountKey, webhookId: string): Promise<{ tenantId: string; channel: ChannelAccountKey } | null>;
}
export type SecretKind = "channel" | "addon";
export interface SecretsRepo {
  /** Decrypted secrets, or null when none are stored. Server-only. */
  get<T = Record<string, unknown>>(tenantId: string, kind: SecretKind, key: string): Promise<T | null>;
  /** Encrypts (lib/crypto.ts AES-GCM) and stores, replacing what was there. Never touches status/connected_at. */
  set(tenantId: string, kind: SecretKind, key: string, value: unknown): Promise<void>;
  clear(tenantId: string, kind: SecretKind, key: string): Promise<void>;
}

// ---------------- audit / usage ----------------
export interface AuditQuery { actor?: string; action?: string; detail?: string }
export interface AuditRepo {
  /**
   * Never put PII (emails, message text, tokens) in detail: counts, hashes and ids only.
   * `tenantId` may be AUDIT_GLOBAL_TENANT ("system") for events that belong to no tenant.
   */
  log(tenantId: string, actor: string, action: string, detail?: string): Promise<void>;
  /** First matching row's detail in this tenant, or null. */
  find(tenantId: string, q: AuditQuery): Promise<string | null>;
  list(tenantId: string, q?: AuditQuery): Promise<{ actor: string; action: string; detail: string; createdAt: string }[]>;
  deleteByActor(tenantId: string, actor: string): Promise<number>;
}
export interface UsageRow { tenantId: string; period: string; requests: number; inputTokens: number; outputTokens: number }
export interface UsageRepo {
  /** Adds to the month of `at` (period = first day of that month, UTC, "YYYY-MM-01"). */
  record(tenantId: string, v: { requests?: number; inputTokens?: number; outputTokens?: number }, at?: Date): Promise<UsageRow>;
  get(tenantId: string, period?: string): Promise<UsageRow>;
  /**
   * Tokens left this month: tenants.aiMonthlyTokenCap - (inputTokens + outputTokens) of the month of `now`,
   * never negative. 0 when the tenant does not exist or is not active (fail closed; L1).
   */
  remaining(tenantId: string, now?: Date): Promise<number>;
}

// ---------------- abuse limits ----------------
/** Engine lookup / inbound limiter storage. Times are epoch ms. Hashes only (never raw order numbers or emails). */
export interface LimiterRepo {
  countLookupFailures(tenantId: string, since: number, by?: { orderHash?: string; emailHash?: string }): Promise<number>;
  /** Records one failure and prunes this tenant's rows older than `pruneBefore`. */
  recordLookupFailure(tenantId: string, orderHash: string, emailHash: string, at: number, pruneBefore: number): Promise<void>;
  /** Logs one inbound message, prunes older than `pruneBefore`, returns the count after `since` (including this one). */
  recordInbound(tenantId: string, conversationId: string, at: number, pruneBefore: number, since: number): Promise<number>;
}
/** Global (not tenant-owned) counters keyed by HMAC-hashed keys. */
export interface RateLimitsRepo {
  /** Fixed-window counter. */
  hit(key: string, limit: number, windowMs: number, now: number): Promise<{ ok: boolean; retryAfterS: number }>;
  recordLoginFailure(keys: string[], now: number): Promise<void>;
  countLoginFailures(key: string, since: number): Promise<number>;
  clearLoginFailures(key: string): Promise<void>;
  /** Drops login rows and rate-limit windows older than `before`. Returns rows deleted. */
  purge(before: number): Promise<number>;
}

// ---------------- retention / privacy ----------------
export interface PurgeCutoffs { cutoff: string; maskCutoff: string; maskedBody: string }
export interface TenantPurge { messagesDeleted: number; conversationsDeleted: number; messagesMasked: number; deletedConversationIds: string[] }
export interface CustomerConversation {
  id: string; channel: string; externalId: string; customerName: string; status: string;
  escalationReason: string | null; state: string; createdAt: string; lastMessageAt: string;
}
export interface RetentionRepo {
  /** CROSS-TENANT (retention job): every tenant id that may hold data. */
  tenantIds(): Promise<string[]>;
  /**
   * One tenant, atomically: delete messages older than `cutoff` outside legal hold, delete conversations idle since
   * before `cutoff` (not on hold), mask bodies of legal-hold messages older than `maskCutoff`.
   */
  purgeTenant(tenantId: string, c: PurgeCutoffs): Promise<TenantPurge>;
  findCustomerConversations(tenantId: string, channel: string, externalId: string): Promise<CustomerConversation[]>;
  /** Atomically deletes the conversations and their messages. */
  deleteConversations(tenantId: string, ids: string[]): Promise<{ conversations: number; messages: number }>;
  /** Every message of a conversation, oldest first (ARCO export: no limit). */
  exportMessages(tenantId: string, conversationId: string): Promise<{ direction: string; sender: string; body: string; createdAt: string }[]>;
  /** CROSS-TENANT (Meta data-deletion callback): tenants/channels holding Messenger/Instagram data for this id. */
  findMetaDeletionTargets(externalId: string): Promise<{ tenantId: string; channel: string }[]>;
  /** CROSS-TENANT: was a Meta deletion request with this confirmation code audited? */
  metaDeletionReceived(code: string): Promise<boolean>;
}

export interface DataStore {
  readonly backend: DataBackend;
  tenants: TenantsRepo;
  platformAdmins: PlatformAdminsRepo;
  members: MembersRepo;
  users: UsersRepo;
  settings: SettingsRepo;
  brand: BrandRepo;
  sections: SectionsRepo;
  sources: SourcesRepo;
  chunks: ChunksRepo;
  conversations: ConversationsRepo;
  messages: MessagesRepo;
  addons: AddonsRepo;
  channels: ChannelsRepo;
  secrets: SecretsRepo;
  audit: AuditRepo;
  usage: UsageRepo;
  limiter: LimiterRepo;
  rateLimits: RateLimitsRepo;
  retention: RetentionRepo;
}
