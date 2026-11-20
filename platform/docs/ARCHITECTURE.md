# Social Inbox platform: architecture and build contract

A multi-tenant-ready chat assistant for brands on WhatsApp, Instagram and Messenger. First tenant: Chefman (Mexico).
Runs ON-PREM for now (`npm run dev`, SQLite file in `data/`). Production target later: Vercel + Supabase + OpenAI.

## Product rules (from the owner; do not violate)
- Assistant is READ-ONLY: order STATUS only (no address, items, phone, payment). Anything else: customer does it on their own platform or a human takes over.
- Order check = order number + email, exact match; generic failure message ("no encontramos ese pedido") on mismatch; attempt limits per conversation.
- Answers ONLY from the tenant's context sections, uploaded files, linked sources and Shopify status. Never invent. Never create discounts/promos/prices. If no source supports an answer: hand off to a human.
- Always escalate: safety hazards (fire, smoke, burns, shock, injury), legal threats (demanda, abogado, PROFECO, sue, lawyer), explicit request for a human.
- Spanish by default (Mexico), switch to English when the customer writes English. UI is Spanish with English toggle.
- Tone: slider 1 (most serious/formal) to 5 (most friendly/casual). Tone never changes guardrails.
- Cross-sell is configurable per tenant (0 off, 1 soft, 2 normal, 3 active); never during complaints or safety/legal cases; at most one per conversation.
- UI must be very simple: one clear primary button per task.
- Every DB query is scoped by tenant_id. Secrets (tokens) only via `addons`/`channel_accounts` (AES-GCM encrypted). Never log secrets or customer emails.

## Stack
Next.js 16 App Router + TypeScript + Tailwind 4. READ `node_modules/next/dist/docs/` before using Next APIs: this Next has breaking changes (e.g. `cookies()` is async, `params`/`searchParams` are Promises, middleware is `proxy`).
SQLite via `node:sqlite` (`src/lib/db.ts`). Tests: `vitest` (`npm test`). Validation: `zod`. File text: `unpdf` (pdf), `mammoth` (docx).

## Foundation (DONE, do not rewrite; extend in your own files)
- `src/lib/types.ts` shared contract types (Channel, AgentSettings, OrdersConnector, InboundEvent, EngineReply...).
- `src/lib/data/` the ONLY data access: `getData()` returns an async, tenant-scoped `DataStore` (see "Data layer" below). No module calls `getDb()` or writes SQL.
- `src/lib/auth.ts` (`requireSession()` in route handlers/actions, `getSession()` in pages), `src/lib/crypto.ts`, `src/lib/seed.ts`.
- `src/lib/i18n.ts` (server `getLocale`/`makeT`) and `src/lib/i18n-client.tsx` (`useT`). Each module owns its dictionary file (`Dict = {es:{}, en:{}}`), no central registry.
- `src/components/ui/index.tsx` Button, LinkButton, Card, Badge, Field, PageHeader, inputCls. Reuse; keep the look consistent. Mobile-friendly.
- App shell `src/app/(app)/layout.tsx` with sidebar. Routes: /dashboard (done), /context, /tone, /sources, /inbox, /addons, /channels (placeholders to replace).

## Module ownership (edit ONLY your own paths; read anything)
| Agent | Owns |
| --- | --- |
| context | `src/app/(app)/context/**`, `tone/**`, `sources/**`, `src/lib/context/**`, `src/app/api/sources/**` |
| inbox | `src/app/(app)/inbox/**`, `channels/**`, `src/app/api/inbox/**`, `src/app/api/webhooks/**`, `src/lib/channels/**` |
| engine | `src/lib/engine/**` (+ tests in `src/lib/engine/__tests__`) |
| shopify | `src/app/(app)/addons/**`, `src/lib/shopify/**`, `src/app/api/shopify/**` |

Shared files (package.json, globals.css, layout, src/lib/data/types.ts, types.ts): do not edit. If you truly need a change there, write the request in `docs/REQUESTS.md` (append a line) and work around it.
Do NOT run `next dev` or `next build` (the lead integrates). Verify with `npx tsc --noEmit` (ignore errors in other agents' files) and `npm test`.

## Contracts between modules
1. Engine: `handleInbound(ev: InboundEvent): Promise<EngineReply>` in `src/lib/engine/index.ts`.
   - Persists the inbound message and the bot reply (via `getData()`) so webhooks and the simulator behave the same.
   - If conversation.status is `needs_human` or `human`, or bot disabled: store the inbound message, return `{text:"", escalated:false}` (no bot reply).
   - On escalation: set status `needs_human` with `escalation_reason` (`safety|legal|human_request|no_answer|attempts|bot_disabled`), reply with a calm handoff message (tone-aware, mentions business hours), call `notifyHandoff` from `@/lib/channels/handoff`.
   - Inbound dedupe by `providerMessageId` (stored in message.meta).
2. Channels: `sendToCustomer(tenantId, conversation, text)` in `src/lib/channels/send.ts`. Simulator channel just stores nothing extra (the message is already saved). Real channels call the Meta Graph API using decrypted tokens; if tokens missing, return `{ok:false}` without throwing.
   `notifyHandoff(tenantId, conversationId, reason)` in `src/lib/channels/handoff.ts`: writes an email-like file to `data/outbox/` and logs (no SMTP locally). Includes last 10 messages + reason + link to inbox thread. Stub exists once the inbox agent creates it; engine imports it.
3. Orders: engine calls `getOrdersConnector(tenantId)` from `@/lib/connectors/registry`. `null` means no add-on: the assistant says it cannot check orders and offers a human. The Shopify agent implements `shopifyConnector` in `src/lib/shopify/connector.ts` (stub exists).
4. Knowledge: the context agent re-indexes chunks via `getData().chunks.replace` / `replaceSection` (sections: `sectionKey`; sources: `sourceId`) whenever a section is saved or a source is synced. Engine retrieves with `getData().chunks.list(tenantId)` (keyword scoring; no embeddings needed locally) and also reads `getEffectiveSectionContent` (`src/lib/context/section-repo.ts`: typed text or the section file, plus linked sources, capped at 20k chars) for the always-on sections (`escalation`, `dos_donts`). Section chunks are built from the same effective content; linked-source chunks carry both `sectionKey` and `sourceId`.
5. Inbox UI polls `/api/inbox/...` every ~4 s (no websockets locally).

## Production notes (do later, keep code ready)
Add the Supabase implementation of `DataStore` (`src/lib/data/supabase`, `DATA_BACKEND=supabase`) on the schema in `supabase/migrations`; Vercel hosting; Meta app review; per-brand OAuth; SMTP/Resend for handoff; KMS for secrets; rate limiting at the edge; DPA/aviso de privacidad (LFPDPPP).

## Platform security + data lifecycle (added by FIXER-B)
- `src/lib/security/origin.ts`: `assertSameOrigin(req)` / `checkSameOrigin(req)`. Call first in every cookie-authenticated, state-changing route handler (not in webhooks or the Shopify OAuth callback).
- `src/lib/security/rate-limit.ts`: `limitOr429(key, limit, windowMs)`, login failure counters (HMAC-hashed keys, lazily created tables `rate_limits`, `login_attempts`).
- `src/lib/retention/`: `purgeOldData`, `deleteCustomerData`, `exportCustomerData`, Meta `handleMetaDataDeletion`. CLI: `npm run purge | delete-customer | set-password | backup`. Ops guide: `docs/RUNBOOK.md`.
- `db.ts` exports `DATA_DIR` and `OUTBOX_DIR`; everything that writes customer data to disk must stay under `DATA_DIR`.

## Data layer (stage 1: 2026-11-19 interface + SQLite; stage 2: 2026-11-20 Supabase backend)
- `src/lib/data/types.ts`: the `DataStore` contract, split into sub-repos: `tenants`, `platformAdmins`, `members` (read-only), `users` (local
  login until Supabase Auth), `settings`, `brand`, `sections`, `sources`, `chunks`, `conversations`, `messages`, `addons`,
  `channels`, `secrets`, `audit`, `usage` (ai_usage per month), `limiter`, `rateLimits`, `retention`. Every method is async;
  tenant-owned data always takes `tenantId` explicitly. Cross-tenant methods are named and documented as such (webhook
  routing, Meta deletion callback, retention job, login by email).
- `src/lib/data/index.ts`: `getData()` picks the backend from `DATA_BACKEND` (`sqlite` default, or `supabase`).
- `src/lib/data/rules.ts`: backend-neutral rules both backends share (brand validation = the CHECK constraints, setting
  clamps, `usagePeriod`). `src/lib/data/errors.ts`: `DataConflictError`, `DataValidationError`, `DataBackendError`
  (code + table/op only, never row values), `DataBackendUnsupportedError`.
- `src/lib/data/sqlite/**`: the SQLite implementation (all SQL lives here). `src/lib/db.ts` keeps the connection, schema and
  additive migrations (`runMigrations`).
- `src/lib/data/supabase/**` (SERVER ONLY): service-role client from `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SECRET_KEY`
  (clear error when missing). The service role bypasses RLS, so tenant isolation is enforced in code: every query on a
  tenant-owned table goes through `scoped(db, tenantId)` (`client.ts`), which adds `tenant_id = …` to every
  select/update/delete, stamps `tenant_id` on inserted rows, strips it from update patches and forces `p_tenant` on RPCs.
  Only the documented cross-tenant lookups use the raw client. Mapping vs SQLite: uuid tenant/row ids (a non-uuid
  tenant id throws `DataValidationError`; a non-uuid row id is "not found"); `tenants.ensure(slug, name)` returns the uuid
  (SQLite returns the id it was given; callers must use the returned id); `channel_accounts.external_id` column
  (`uq_channel_external` 23505 -> `DataConflictError("channel_in_use")`); `messages.provider_message_id` column
  (`uq_msg_provider` 23505 = duplicate inbound -> the stored message is returned); secrets in `tenant_secrets(kind,key)`
  (same lib/crypto.ts ciphertext); timestamptz <-> ISO-Z / epoch ms; `conversations.legal_hold` (counts as legal hold,
  surfaced as `state.legalHold` to lib/retention); `agent_settings.tone_saved_at`; `business_hours` jsonb <-> string;
  `sources.storage_path` = `filePath`. Reads past PostgREST's row cap are paged.
  Atomic operations are SQL functions (EXECUTE only for service_role): `rate_limit_hit`, `usage_add`, `conversation_touch`
  (`supabase/migrations/20261120100000_server_rpc_counters.sql`, also adds `login_attempts`) and `retention_purge_tenant`,
  `retention_delete_conversations` (`20261120100100_server_rpc_retention.sql`).
  Not offered in Supabase mode (clear `DataBackendUnsupportedError`): local password login (`users.findLoginByEmail`,
  `create`, `setPasswordHash`: Supabase Auth, stage 3). File sources work since wave 1 (stage 4): `sources.create({kind:
  "file", filePath})` stores `storage_path` and refuses (`DataValidationError("filePath")`) any path that does not start
  with THIS tenant's uuid + "/" (bytes: see "Storage" below).
  Real migration file names: `20261119235721_server_rpc_counters.sql`, `20261119235722_server_rpc_retention.sql` (applied);
  `20261120002400_platform_tenant_overview.sql` (wave 1, written, NOT applied yet; test `supabase/tests/platform_tenant_overview.sql`).

### Wave 1 additions (2026-11-19) - the interface wave 2 uses
All in `src/lib/data/types.ts`, implemented in both backends, covered by `data-store-contract.ts` (incl. cross-tenant
negatives), the Supabase fake and the tenant-scoping proof.
- `tenants.get(tenantId): TenantInfo | null` with `TenantInfo = {id, name, slug, plan: "free"|"pro"|"business",
  status: "active"|"suspended"|"deleted", aiMonthlyTokenCap, createdAt}` (SQLite: additive columns, slug falls back to the id).
- `tenants.listAll({limit?, offset?, search?, now?}): {items: TenantOverview[], total, period}`. CROSS-TENANT, for the
  platform-admin screen only: the CALLER must check `platformAdmins.isPlatformAdmin(session.userId)` first.
  `TenantOverview = TenantInfo + {members, conversationsThisMonth, connectedChannels, aiTokensThisMonth}`; newest first;
  limit 1..200 (default 50); search = case-insensitive substring of name/slug, LIKE wildcards literal; "this month" =
  UTC calendar month of `now` (conversations: non-simulator with `last_message_at` in the month; tokens: input+output of
  ai_usage). Supabase: ONE RPC `platform_tenant_overview` (service_role only); SQLite: one query with subqueries.
- `platformAdmins.isPlatformAdmin(userId): boolean`. Supabase: `public.platform_admins` (owner inserts rows in SQL).
  SQLite: env `PLATFORM_ADMIN_EMAILS` (comma-separated, matched against the local user's email). Malformed ids: false.
- `usage.remaining(tenantId, now?): number` = `aiMonthlyTokenCap - (inputTokens + outputTokens)` of the month, never
  negative, 0 for an unknown tenant (fail closed). (`usage.record` / `usage.get` unchanged.)
- `ChannelAccount.webhookId: string | null`: public random uuid of the channel row (Supabase `channel_accounts.webhook_id`;
  SQLite additive `webhook_id` column, backfilled, unique). Set once, never changed by `channels.save`; null until the row
  exists. NOT a secret.
- `channels.findByWebhookId(channel, webhookId): {tenantId, channel} | null`. CROSS-TENANT (Telegram routing:
  `/api/webhooks/telegram/<webhookId>`). Only `connected` accounts match; malformed / unknown / other channel -> null.
- Telegram secret: stored ONLY inside the encrypted channel secrets (`secrets.set(t, "channel", "telegram",
  {botToken, webhookSecret})`); the `tenant_secrets.webhook_secret_hash` column stays unused. Helpers in
  `src/lib/channels/telegram-secret.ts`: `newTelegramWebhookSecret()`, `telegramSecretMatches(expected, provided)`
  (constant time, fails closed), `TELEGRAM_SECRET_HEADER`, and `authenticateTelegramWebhook(webhookId, headerValue)`
  (routing id -> connected tenant -> decrypted secret -> compare; returns `{tenantId}` or null).
- `AUDIT_GLOBAL_TENANT` (`"system"`): `audit.log("system", ...)` writes a row with no tenant (Supabase: `tenant_id` NULL,
  service role only; SQLite: tenant_id "system"). Used for failed sign-ins and the Meta deletion callback fallback.
- Audit events (`src/lib/audit-events.ts`): `AUDIT` action names + `auditEvent()` (never throws) + `auditSignIn()`.
  Written server side: Supabase sign-in ok (one row per membership tenant) / failure (global), hashed IP only;
  invitation created (`role=...`, never the email/link), revoked, role changed, member removed (team/actions.ts).
  Already written elsewhere: tenant created and invitation accepted (by the `create_tenant` / `accept_invitation` RPCs,
  with actor_user_id), channel connect/disconnect (channels/actions.ts), Shopify connect/disconnect (api/shopify/*).
  Wave 2 branding must call `auditEvent(tenantId, userId, AUDIT.brandSaved, "<changed field names>")`.
- Team directory: `listTeamDirectory(session)` in `src/lib/auth/team.ts` = `getData().members.list(session.tenantId)`
  (service role, real names + emails) after checking the active tenant is one of the session's memberships. Role
  changes, removals and invitation revokes still go through the user-session client (RLS).
- `ensureSeed()` is a no-op in Supabase mode (onboarding creates tenants; no local users).
- Secrets only through `secrets` (`get/set/clear(tenantId, "addon" | "channel", key)`): `addons.get` / `channels.get` never return them.
  Disconnecting an add-on (`addons.save(..., {status:"disconnected"})`) also wipes its secrets; channels need `secrets.clear`.
- `channels.save` throws `DataConflictError` when another tenant already has that account connected.
- Guards: `src/lib/data/__tests__/boundary.test.ts` (no `node:sqlite` / `getDb()` / SQL outside the data layer);
  `data-store-contract.ts`, the ONE behavioural suite (cross-tenant negative tests + behaviour) run by
  `tenant-isolation.test.ts` (SQLite), `supabase-backend.test.ts` (Supabase store on the in-memory query-builder fake
  `supabase-fake.ts`, plus mapper/error tests and the proof that every tenant-owned query carried a tenant_id filter) and
  `supabase-contract-live.test.ts` (real project; only with `RUN_LIVE=1`, excluded by `*-live`); `supabase-boundary.test.ts`
  (no "use client" file imports the data layer or the service key); and the type-aware `no-floating-promises` /
  `no-misused-promises` lint rules (a forgotten `await` is a lint error).

## Storage (stage 4, wave 1: 2026-11-19)
`src/lib/storage/` is the ONLY file access for tenant files and brand assets (server only; a boundary test forbids
importing it from "use client" files). The backend follows `DATA_BACKEND`:
- `local` (sqlite, default): `DATA_DIR/uploads/<tenantId>/<key>` (today's layout, so existing files keep working) and
  `DATA_DIR/brand-assets/<tenantId>/<key>`; every resolved path must stay inside the tenant folder.
- `supabase`: Storage buckets from the init migration, written with the service-role client of
  `src/lib/data/supabase/client.ts` (`Db.storage` subset): `tenant-files` (private, 10 MB, pdf/txt/md/csv/html/docx) and
  `brand-assets` (public, 2 MB, png/jpeg/webp, no SVG). Object path ALWAYS `<tenantId>/<key>`.

Interface (`src/lib/storage/types.ts`), from `getFileStore(bucket = "tenant-files")`:
```ts
put(tenantId, key, bytes: Uint8Array, contentType): Promise<string>   // returns "<tenantId>/<key>" to persist
get(tenantId, key): Promise<Uint8Array | null>                       // null = missing
remove(tenantId, key): Promise<void>                                 // idempotent
stat(tenantId, key): Promise<{key, size, updatedAt} | null>
list(tenantId, prefix): Promise<{key, size, updatedAt}[]>            // direct children, name order, max 1000
publicUrl(tenantId, key): string                                     // brand-assets only
```
Rules: `key` is tenant-relative and SERVER-built (`uploadKey(name)` = `<uuid>-<sanitizeName(name)>`, or fixed names);
`safeKey` refuses traversal, empty/dot segments, more than 4 segments (`StoragePathError`, no path in the message). The
store always prepends the validated tenant folder, so a tenant can only address its own objects. A persisted path is
turned back into a key with `keyFromStored(tenantId, stored)`, which returns null for another tenant's path: use it
before every read/delete of `sources.filePath` / `brand.logoPath`. Errors are `StorageBackendError` (bucket + op only).
Who uses it: uploads (`lib/context/upload.ts` `storeUpload`: content type from the extension, never the browser's MIME;
`discardUpload` if the row insert fails), source indexing (`index-source.ts`), source deletion (`section-index.ts`
`deleteSourceAndLinks`), the Context page file size (`stat`), and the handoff outbox (`lib/storage/outbox.ts`:
local = unchanged flat `DATA_DIR/outbox/`; Supabase = `<tenantId>/outbox/<ts>-<conversationId>.txt` in `tenant-files`)
which `lib/retention` purges (30 days) and deletes per customer.
Logos (`src/lib/storage/logo.ts`): `uploadLogo(tenantId, bytes, contentType) -> {ok:true, path, url} | {ok:false,
error:"empty"|"too_big"|"bad_type"}` (png/jpeg/webp only, max 2 MB, magic bytes must match the declared type, SVG always
rejected, new random key `logo-<uuid>.<ext>` per upload); `logoUrl(tenantId, logoPath)`; `removeLogo(tenantId, logoPath)`.
Wave 2 flow: `uploadLogo` -> `getData().brand.save(tenantId, {logoPath: r.path})` -> `removeLogo(old)` ->
`auditEvent(..., AUDIT.brandSaved, "logoPath")`. Local logos are served by `GET /api/brand-assets/<tenantId>/<file>`
(only `logo-<uuid>.<png|jpg|webp>`, nosniff, immutable cache); in Supabase mode the bucket's public URL is used.
Tests: `src/lib/storage/__tests__/storage.test.ts` (one FileStore contract for both backends incl. cross-tenant negatives,
bucket rules on the fake, logos, Supabase-mode outbox and the full upload -> index -> delete flow on the fake project).

## AI provider (wave 2B: 2026-11-19; wave 4: official SDK, spend guards)
- `src/lib/engine/llm.ts`. Provider per call (`selectProvider`): **Anthropic** when `ANTHROPIC_API_KEY` is set (model
  `ANTHROPIC_MODEL`, default `claude-haiku-5-5`); OpenAI (legacy, plain fetch) only when there is no Anthropic key, or
  `AI_PROVIDER=openai` with `OPENAI_API_KEY`; otherwise the deterministic offline fallback (extractive answer or `[HANDOFF]`).
- Anthropic goes through the official TypeScript SDK `@anthropic-ai/sdk` (1.x, which sends API version `2026-10-21`):
  one `new Anthropic({ apiKey, timeout: 10_000, maxRetries: 1, logLevel: "off" })` per key (`anthropicClient`), then
  `client.messages.create(params)`. The client is injectable (`anthropicLLM(key, model, { client })`) so tests mock the
  SDK, never the network. Retries (429 / 5xx / 529 / connection errors, honouring `retry-after`) and timeouts are the
  SDK's own (client options); 4xx are not retried.
- Params (`anthropicParams`): `{model, max_tokens, system: [stable block (+cache_control ephemeral), sources block],
  messages: [{role: "user", content}], output_config: {effort: "low"}}`. Model rules from the claude-api skill:
  Haiku 5.5 runs adaptive thinking when `thinking` is omitted; the skill says to use effort as the lever (not
  `thinking: disabled`), `low` being the cheapest level for chat / simple high-volume routes, and to leave room for
  thinking in `max_tokens` (1024 for the 5.x family, 400 for models without default thinking). No temperature / top_p /
  top_k (400 on 2026-10-21 and on Haiku 5.5), no assistant prefill, no `fallbacks` (Haiku 5.5 has no server-side
  fallback). `output_config.effort` is only sent to models that accept it (it 400s on Haiku 4.5).
- Response (`parseAnthropicMessage`): text blocks joined by type (a reply can start with `thinking` blocks); usage =
  `input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`. `stop_reason: "refusal"` ->
  `[HANDOFF]` (usage kept); `stop_reason: "max_tokens"` -> deterministic answer (never a truncated reply; usage kept).
  Typed SDK errors (`APIConnectionTimeoutError`, `APIConnectionError`, `RateLimitError`, `AuthenticationError`,
  `BadRequestError`, `InternalServerError`, `APIError`) -> offline fallback (not metered); logs carry the class /
  status only (never prompt, reply, key or the SDK error message).
- Interface: `LLM = (req) => Promise<LLMResult | string>`, `LLMResult = {text, usage: {inputTokens, outputTokens,
  cacheReadTokens?, cacheWriteTokens?}, model}` (a bare string, used by test fakes, means unknown usage).
- Prompt caching: `buildSystemPromptParts()` (prompt.ts) splits the system prompt into the per-tenant stable part (rules,
  tone, dos/don'ts, escalation rules) and the per-question `<sources>`. The breakpoint sits on the stable part only when
  its estimated size reaches the model's minimum cacheable prefix (`minCacheableTokens`: 512 on Haiku 5.5, 4,096 on
  Haiku 4.5, 1,024 default); a shorter prefix gets no breakpoint (it would not cache anyway).
- Guardrails unchanged and still in front of / behind the call: deterministic escalations, injection hardening, PII
  redaction (`redactPII` / `redactForLLM`: emails, phones, order/tracking numbers never reach the provider; tested on
  the SDK request params), the `[HANDOFF]` token and `validateReply` (promos, URLs, invented numbers, action claims,
  prompt leak).
- Metering + caps (`usage.ts`, `spend.ts`, `EngineDeps.usage` injectable). Before a paid call the engine reads
  `usage.remaining(tenantId)` and reserves the call's upper bound (`estimateCallTokens` = prompt chars / 3.5 +
  max_tokens) with `reserveSpend()`:
  - tenant: `remaining - in-flight reservations of this tenant >= estimate` (so parallel calls cannot overshoot by more
    than what other instances have in flight); otherwise no paid call, offline answer or handoff with
    `escalation_reason = "ai_cap_reached"` (meta `intent: "ai_cap_reached"`, `aiCap: true`) and one audit event per
    tenant per UTC day (`ai.cap_reached`, actor `engine`, detail `day=YYYY-MM-DD`). Unreadable budget: fail closed.
  - platform: `PLATFORM_DAILY_TOKEN_CAP` tokens per UTC day across ALL tenants (default 5,000,000; `0` = no paid call).
    There is no cross-tenant daily usage query (ai_usage is monthly per tenant), so the total is kept in-process (exact
    used + in-flight) and in the shared `rate_limits` table (key `engine-ai-day:YYYY-MM-DD`, units of 1,000 tokens,
    `ceil(estimate / 1000)` units taken before each call and never refunded: conservative, works across instances).
    Over the cap: no paid call, offline answer or handoff with reason `no_answer` (meta `intent: "ai_platform_cap"`),
    one `console.warn` per day per process. Counter errors fail closed.
  After every provider call the reservation is settled with the real usage and `usage.record(tenantId, {requests: 1,
  inputTokens: input + cache read + cache write, outputTokens})` runs (best effort). Simulator conversations are metered
  and capped too.
- Simulator abuse limits (`limiter.ts#recordSimulatorMessage`): 30 messages per (tenant, simulator user) and 60 per
  tenant per 10 minutes in `rate_limits` (HMAC-keyed, not tied to the conversation, so DELETE /api/inbox/simulate does
  not reset them); over the limit the engine sends the calm throttle message once, then stays silent, without any LLM
  call. The per-conversation inbound throttle (20 / 10 min) still applies to every channel.
- Tests: `src/lib/engine/__tests__/anthropic-integration.test.ts` (injected fake SDK client and the real SDK over a
  mocked fetch: params, no PII in the params, parsing incl. usage, refusal / max_tokens, typed errors, retries, provider
  selection, tenant cap, reservation, platform daily cap, per-tenant metering incl. cross-tenant negatives) and
  `wave4-copy-limits.test.ts` (simulator limits across restarts, cross-tenant negative, bot copy).