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
- `src/lib/store.ts` CRUD for settings, context sections, sources, chunks, conversations, messages, addons, channel accounts, audit. Do NOT edit; add new queries in your own module repo using `getDb()`.
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

Shared files (package.json, globals.css, layout, store.ts, types.ts): do not edit. If you truly need a change there, write the request in `docs/REQUESTS.md` (append a line) and work around it.
Do NOT run `next dev` or `next build` (the lead integrates). Verify with `npx tsc --noEmit` (ignore errors in other agents' files) and `npm test`.

## Contracts between modules
1. Engine: `handleInbound(ev: InboundEvent): Promise<EngineReply>` in `src/lib/engine/index.ts`.
   - Persists the inbound message and the bot reply (via store.ts) so webhooks and the simulator behave the same.
   - If conversation.status is `needs_human` or `human`, or bot disabled: store the inbound message, return `{text:"", escalated:false}` (no bot reply).
   - On escalation: set status `needs_human` with `escalation_reason` (`safety|legal|human_request|no_answer|attempts|bot_disabled`), reply with a calm handoff message (tone-aware, mentions business hours), call `notifyHandoff` from `@/lib/channels/handoff`.
   - Inbound dedupe by `providerMessageId` (stored in message.meta).
2. Channels: `sendToCustomer(tenantId, conversation, text)` in `src/lib/channels/send.ts`. Simulator channel just stores nothing extra (the message is already saved). Real channels call the Meta Graph API using decrypted tokens; if tokens missing, return `{ok:false}` without throwing.
   `notifyHandoff(tenantId, conversationId, reason)` in `src/lib/channels/handoff.ts`: writes an email-like file to `data/outbox/` and logs (no SMTP locally). Includes last 10 messages + reason + link to inbox thread. Stub exists once the inbox agent creates it; engine imports it.
3. Orders: engine calls `getOrdersConnector(tenantId)` from `@/lib/connectors/registry`. `null` means no add-on: the assistant says it cannot check orders and offers a human. The Shopify agent implements `shopifyConnector` in `src/lib/shopify/connector.ts` (stub exists).
4. Knowledge: the context agent re-indexes chunks via `replaceChunks` (sections: `sectionKey`; sources: `sourceId`) whenever a section is saved or a source is synced. Engine retrieves with `listChunks(tenantId)` (keyword scoring; no embeddings needed locally) and also reads `getEffectiveSectionContent` (`src/lib/context/section-repo.ts`: typed text or the section file, plus linked sources, capped at 20k chars) for the always-on sections (`escalation`, `dos_donts`). Section chunks are built from the same effective content; linked-source chunks carry both `sectionKey` and `sourceId`.
5. Inbox UI polls `/api/inbox/...` every ~4 s (no websockets locally).

## Production notes (do later, keep code ready)
Replace db.ts/store.ts with Supabase Postgres + RLS on tenant_id; Vercel hosting; Meta app review; per-brand OAuth; SMTP/Resend for handoff; KMS for secrets; rate limiting at the edge; DPA/aviso de privacidad (LFPDPPP).

## Platform security + data lifecycle (added by FIXER-B)
- `src/lib/security/origin.ts`: `assertSameOrigin(req)` / `checkSameOrigin(req)`. Call first in every cookie-authenticated, state-changing route handler (not in webhooks or the Shopify OAuth callback).
- `src/lib/security/rate-limit.ts`: `limitOr429(key, limit, windowMs)`, login failure counters (HMAC-hashed keys, lazily created tables `rate_limits`, `login_attempts`).
- `src/lib/retention/`: `purgeOldData`, `deleteCustomerData`, `exportCustomerData`, Meta `handleMetaDataDeletion`. CLI: `npm run purge | delete-customer | set-password | backup`. Ops guide: `docs/RUNBOOK.md`.
- `db.ts` exports `DATA_DIR` and `OUTBOX_DIR`; everything that writes customer data to disk must stay under `DATA_DIR`.
