# 04 - Integration Architect proposal

## Recommendation (short)
**Option A: custom code on Vercel + Supabase + OpenAI, with our own multi-tenant Meta app.** Chefman launches in 2 weeks in Meta *Standard Access* (no App Review). In parallel we start Business Verification + App Review so brand #2 can self-connect via OAuth. Do not use n8n or a helpdesk as the core.

## 1. Meta integration

**Architecture:** one Meta app (ours), one webhook endpoint `/api/meta/webhook` (Vercel route). It verifies `X-Hub-Signature-256` with the app secret, stores the raw event idempotently (message mid as key), returns 200 immediately, and enqueues processing (Supabase queue / pg_cron / Vercel background function). Route by `page_id` or `ig_account_id` to a `channel` row, then to a tenant. Reply via Send API using the per-channel Page access token (stored encrypted). Webhook fields: `messages`, `messaging_postbacks` (Messenger); `messages` (IG). Ignore comments (owner decision), so we do not subscribe to comment fields.

**Permissions:** Messenger needs `pages_messaging`, `pages_manage_metadata`, `pages_show_list`. Instagram (Instagram Login or Facebook Login path) needs `instagram_business_manage_messages` or `instagram_manage_messages`. The IG account must be Professional and linked to the FB Page, and "Allow access to messages" must be enabled on the IG account. Both channels have a 24h reply window after the customer's last message. Proactive outreach is out of scope, so this is not a problem.

**Access levels and reality (web-verified, mid-2026):**
- *Standard Access* works only for people with a role on the app or its owning Business (admin, developer, tester). No App Review needed.
- *Advanced Access* is required for any brand whose users have no role on our app. It needs **Business Verification** (legal docs, days to weeks) and **App Review with screencasts**. Reported 2026 review times are about 20 days (up from 1-3 days in 2025), with frequent rejections and resubmissions. Budget 3-6 weeks, not days.
- *Tech Provider* status is required when acting on behalf of other businesses. It means Business Verification plus the Tech Provider onboarding (completed in the app dashboard, including access verification). It also unlocks the Embedded-Signup-style flows, mainly WhatsApp-relevant.

**Owner's question: can a brand self-connect via OAuth?**
- **Eventually yes, but not on day 1.** After Advanced Access is approved, a brand admin clicks "Connect Facebook/Instagram" (Facebook Login for Business), picks Pages and IG accounts, and grants permissions. We exchange for long-lived Page tokens, subscribe the Page to webhooks via `POST /{page-id}/subscribed_apps`, and save everything. No developer needed per brand.
- **Before approval, a developer must do it.** The brand admin must be added as app tester/developer (or the brand's Business adds our app as a partner and assigns the Page), and then the same OAuth flow works for them in dev mode.
- **Plan for Chefman in 2 weeks:** build the real OAuth flow now; run it in Standard Access with the Chefman admin added as app role (assumption to verify: the Chefman person accepts a role invite and has Page admin and IG access). Chefman is live without App Review. Their data flows through the same code path brand #2 will use. Meanwhile, submit Business Verification on day 1 (it is the long pole), then App Review once the MVP can be screencast (around week 2).
- **Risk:** Standard Access may be shown as "dev mode" warnings only to our people. If the Meta app is in Development mode, messages from non-role users are NOT delivered, so the app must be switched to Live mode (which is allowed with Standard Access; only unapproved permissions are limited to role users). **Open point to test on day 2:** confirm in a spike that real customers (non-role) messaging Chefman's Page reach our webhook in Live mode with Standard Access. If they do not, Chefman needs Advanced Access too and the 2-week target moves to the App Review timeline. This is the single biggest schedule risk. Mitigation: the fallback is a human-handoff-only mode and a staged launch.

## 2. Shopify (add-on connector)
- **Chefman (now): custom app created in Shopify admin** (or Dev Dashboard app) installed by the merchant, with scopes `read_orders` (plus `read_customers` only if needed). Admin pastes the Admin API token in our dashboard; stored encrypted. No Shopify review needed (protected-customer-data review applies only to public apps). Needs a Shopify plan that allows custom apps (all paid plans do; verify Chefman's plan).
- **Gotcha:** `read_orders` returns only the last 60 days unless `read_all_orders` is granted. Acceptable for "where is my order", worth documenting.
- **Later (brand #2+):** public/OAuth app via Partner Dashboard, which requires Shopify app review and protected customer data approval. Do it only if self-serve install matters; paste-a-token is fine for the first 3-5 brands.
- **Order lookup:** GraphQL `orders(query: "name:#1234")`, then compare the email on the order to the email the customer gave (case-insensitive exact match). On mismatch or not found, give one generic message ("couldn't verify") with no detail leak. Limit attempts per conversation (3) and per sender. Return only status, fulfillment status, carrier and tracking link (no address or items, per brief). Orders data is fetched live and not stored beyond the message log (redact order numbers and emails in stored transcripts if retention requires).

## 3. Connector / plugin architecture
Define a `Connector` interface: `id`, `configSchema` (zod, drives the admin form), `auth` (token/OAuth), `tools[]` (LLM function definitions with JSON schema, read-only flag, required-verification flag), `handler(ctx, args)`. The LLM layer only sees tools enabled for that tenant. Shopify = `shopify.order_status`. Future: Twilio (`channel` type, same inbound/outbound adapter interface as Meta: `normalizeInbound`, `send`), other stores, ticketing. Channels and tools are separate registries so a phone number is just another channel adapter.

## 4. LLM layer, RAG, guardrails
- **Model:** OpenAI chat model with function calling (small model for routing and replies, e.g. gpt-4.1-mini class; verify current pricing), embeddings `text-embedding-3-small`. A standard "conversation" = 24h window or N messages, which gives a billable unit.
- **RAG:** admin uploads PDFs/docs/text -> chunk (500-800 tokens) -> embed -> `pgvector` in Supabase, filtered by `tenant_id` (RLS). Retrieve top-k with a similarity threshold. If nothing is above the threshold, the bot must not answer from model memory: it hands off.
- **Guardrails (layered):** (1) system prompt per brand: answer only from retrieved context and tool results, cite source, no promos/discounts/prices not in KB; (2) pre-model rule filter for escalation: safety hazards (fire, burn, shock, "se incendió"), legal/suing words, explicit "humano/agente", both ES/EN keyword list + LLM classifier; (3) post-model check: JSON output with `answer`, `confidence`, `sources`, `needs_human`; reject if no source or a discount pattern appears; (4) cross-sell level (0-3) is a tenant setting injected into the prompt; (5) prompt-injection stance: customer text is data, tools are read-only, tenant scoping enforced in code, never by the model.
- **Handoff:** since the human works by email in business hours, create a `handoff` row and send an email via Resend/Postmark with the transcript summary and the customer's IG/FB handle; tell the customer when to expect an answer. Optionally a "reply from dashboard via Meta Send API" later (inside the 24h window; Human Agent tag allows 7 days).

## 5. Data model (Supabase, RLS on `tenant_id`)
`tenants` (id, name, language, tone, cross_sell_level, plan) · `members` (user_id, tenant_id, role) · `channels` (tenant_id, type ig/fb/twilio, external_id, token_enc, status) · `connectors` (tenant_id, type, config_enc, enabled) · `kb_documents` / `kb_chunks` (tenant_id, text, embedding vector, source) · `contacts` (tenant_id, channel_id, external_user_id, locale) · `conversations` (tenant_id, contact_id, status, started_at, resolved_by bot/human/unresolved) · `messages` (conversation_id, direction, text, tool_calls jsonb, tokens, mid unique) · `handoffs` (conversation_id, reason, emailed_at) · `unanswered` / `events` (for the "what to add next" report) · `usage_daily` (tenant_id, tokens, conversations) for billing. Encrypt tokens with Supabase Vault or app-level AES key. Retention: scheduled purge job (default 90 days, configurable; LFPDPPP privacy notice to review with client).

## 6. Option comparison
| | A: Custom | B: n8n / helpdesk |
|---|---|---|
| Time to Chefman | ~2 weeks, tight but feasible | n8n faster for first flow, but multi-tenant OAuth, per-tenant tokens, admin UI are awkward |
| Multi-tenant | Native | n8n = workflow-per-brand copies; hard to self-serve |
| Meta approval | Same burden either way (n8n does not remove App Review) | Gorgias/Respond.io: brand connects via vendor's already-approved app (fastest legal path) but $300+/mo per brand, weak Spanish guardrails, no white-label |
| Cost/margin | Pay only infra and tokens | Per-seat/per-ticket fees break the monthly-fee model |
| Control of guardrails | Full | Limited |

n8n is acceptable only as a throwaway prototype; I would not buy it.

## 7. Two-week plan
Day 1: Business Verification + Meta app + Standard Access spike. Days 2-5: webhook, Send API, OAuth connect, conversation store. Days 6-9: Shopify tool, RAG, guardrails. Days 10-12: dashboard (tone, store info, uploads, conversations). Days 13-14: Chefman onboarding, test with real accounts, submit App Review.

## Assumptions to verify
Chefman's IG/FB admins and Shopify plan; Standard Access + Live mode delivers non-role user DMs; current OpenAI pricing; Meta timelines are third-party-reported.
