// Shared domain types. This file is the CONTRACT between modules; change with care.

export type Channel = "telegram" | "whatsapp" | "instagram" | "messenger" | "manychat" | "simulator";
export const CHANNELS: Channel[] = ["telegram", "whatsapp", "instagram", "messenger", "manychat", "simulator"];

/**
 * "pending" (the team follows up later) and "waiting_customer" (the team asked the customer something) are
 * HUMAN-OWNED like "needs_human" and "human": the bot stays silent. A customer message on "waiting_customer"
 * moves it back to "human" (the team's turn).
 */
export type ConversationStatus = "bot" | "needs_human" | "human" | "pending" | "waiting_customer" | "resolved";
export const CONVERSATION_STATUSES: ConversationStatus[] = ["bot", "needs_human", "human", "pending", "waiting_customer", "resolved"];
export const HUMAN_OWNED_STATUSES: ReadonlySet<ConversationStatus> = new Set<ConversationStatus>(["needs_human", "human", "pending", "waiting_customer"]);
export const emptyStatusCounts = (): Record<ConversationStatus, number> => ({ bot: 0, needs_human: 0, human: 0, pending: 0, waiting_customer: 0, resolved: 0 });
export type Sender = "customer" | "bot" | "agent";

/** Context is split into these sections. `key` is stable (DB), labels live in i18n. */
export const CONTEXT_SECTION_KEYS = [
  "business",        // who we are, history, values, contact info, hours
  "products",        // catalog highlights, models, specs, usage tips
  "shipping_returns",// shipping times, returns, exchanges
  "warranty",        // warranty terms, how to claim, support
  "faq",             // frequent questions + approved answers
  "escalation",      // when to hand off to a human (safety, legal, complaints)
  "dos_donts",       // what the agent must / must never say (promos, prices...)
  "extra",           // anything else
] as const;
export type ContextSectionKey = (typeof CONTEXT_SECTION_KEYS)[number];

export interface AgentSettings {
  tenantId: string;
  agentName: string;
  toneLevel: 1 | 2 | 3 | 4 | 5; // 1 = most serious ... 5 = most friendly
  languageDefault: "es" | "en";
  languageAlt: "es" | "en";
  greeting: string;
  fallbackMessage: string;
  handoffEmail: string;
  businessHours: string; // JSON string; shape owned by the settings module
  crossSellLevel: 0 | 1 | 2 | 3;
  botEnabled: boolean;
}

export interface ContextSection { key: ContextSectionKey; content: string; updatedAt: string }

export type SourceKind = "link" | "file";
export type SourceStatus = "pending" | "indexed" | "error";
export interface Source {
  id: string; tenantId: string; kind: SourceKind; title: string;
  url: string | null; filePath: string | null; status: SourceStatus;
  error: string | null; lastSyncedAt: string | null; createdAt: string;
}

export interface Chunk { id: string; tenantId: string; sourceId: string | null; sectionKey: string | null; title: string; text: string }

export interface Conversation {
  id: string; tenantId: string; channel: Channel; externalId: string; customerName: string;
  status: ConversationStatus; escalationReason: string | null; state: Record<string, unknown>;
  lastMessageAt: string; unread: number; createdAt: string;
  /**
   * Sticky legal hold (safety/legal escalation, REVIEW-security-2 H1). Set by the data layer, never cleared by app
   * code: the retention purge, customer deletion and the Meta deletion callback keep these conversations.
   */
  legalHold?: boolean;
  /** Team member the conversation is assigned to (null = unassigned). */
  assignedTo?: string | null;
  /** Customer record (one person across channels). Null for simulator conversations. */
  customerId?: string | null;
}

/** One person, possibly writing on several channels (their conversations point at it). */
export interface Customer {
  id: string; tenantId: string; name: string; email: string | null; phone: string | null;
  tags: string[]; notes: string; createdAt: string; updatedAt: string;
}
/** Internal note on a conversation: never sent to the customer. */
export interface ConversationNote { id: string; conversationId: string; authorUserId: string | null; body: string; createdAt: string }
export type ConversationEventKind = "assigned" | "unassigned" | "status" | "note" | "handoff" | "customer_linked";
/** Activity log entry: who did what to the conversation, and when. `actorUserId` null = the assistant / system. */
export interface ConversationEvent {
  id: string; conversationId: string; actorUserId: string | null; kind: ConversationEventKind;
  detail: Record<string, unknown>; createdAt: string;
}
export interface Message {
  id: string; conversationId: string; tenantId: string; direction: "in" | "out";
  sender: Sender; body: string; meta: Record<string, unknown>; createdAt: string;
  /** Channel message id (inbound dedupe). Supabase: messages.provider_message_id; SQLite: meta.providerMessageId. */
  providerMessageId?: string | null;
}

export type AddonKey = "shopify";
export type AddonStatus = "disconnected" | "connected" | "error";
export interface Addon { key: AddonKey; status: AddonStatus; publicInfo: Record<string, unknown>; connectedAt: string | null }

export type ChannelAccountStatus = "disconnected" | "connected" | "error";
export interface ChannelAccount {
  channel: Exclude<Channel, "simulator">; status: ChannelAccountStatus; publicInfo: Record<string, unknown>;
  /** Public random routing id (uuid) used in webhook URLs (Telegram). null until the channel row exists. Not a secret. */
  webhookId: string | null;
}

// ---- Connector interface: add-ons (Shopify now; others later) plug into the engine through this ----
export interface OrderStatusResult {
  found: boolean;
  /** Only status-level data. NEVER address, items, phone or payment (owner decision: status only). */
  statusText?: string;       // e.g. "Enviado"
  trackingUrl?: string;
  trackingNumber?: string;
  carrier?: string;
  estimatedDelivery?: string;
  /** @deprecated no longer emitted (it leaked whether an order exists); use mayBeOutsideWindow. */
  tooOld?: boolean;
  /** found:false only. True when the shop lacks read_all_orders, so an old order may be invisible. Depends on scopes, never on the order. */
  mayBeOutsideWindow?: boolean;
}
export interface OrdersConnector {
  key: AddonKey;
  isConnected(tenantId: string): boolean | Promise<boolean>;
  /** Must match order number AND email exactly (case-insensitive email). Generic failure otherwise. */
  lookupOrderStatus(tenantId: string, orderNumber: string, email: string): Promise<OrderStatusResult>;
}

// ---- Engine contract (implemented by src/lib/engine) ----
export interface InboundEvent {
  tenantId: string; channel: Channel; externalId: string; customerName?: string; text: string; providerMessageId?: string;
  /** Set when the text is a placeholder for a non-text message (photo, voice note...). */
  media?: string;
}
export interface EngineReply { text: string; escalated: boolean; reason?: string }
