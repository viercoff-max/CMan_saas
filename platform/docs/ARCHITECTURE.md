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
- `src/lib/data/types.ts`: the `DataStore` contract, split into sub-repos: `tenants`, `members` (read-only), `users` (local
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
  `create`, `setPasswordHash`: Supabase Auth, stage 3) and creating `kind: "file"` sources (file bytes move to the
  `tenant-files` Storage bucket in stage 4; TODO in `supabase/knowledge.ts`).
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
