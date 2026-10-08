# 07 - Platform Economics and Multi-Brand Architecture

## Recommendation (up front)
**Option A, custom code on Vercel + Supabase + OpenAI, with your own Meta app.** Do not re-buy n8n. Do not buy a helpdesk.

| | A: Custom (Next.js/Vercel + Supabase) | B: n8n low-code | B': Helpdesk (Gorgias/Respond.io) |
|---|---|---|---|
| MVP in 2 weeks | Feasible, narrow scope | Faster to first demo | Fast, but wrong product |
| Multi-tenant | Native (RLS, tenant_id) | Workflow per brand, drifts | Per-seat pricing, no reselling |
| Self-serve onboarding | Yes, built in admin | No, needs a custom admin anyway | Partial |
| Guardrails/eval/cost metering | Full control | Awkward, hard to test | Limited |
| Unit cost at scale | Lowest | n8n license plus hosting | Seat/ticket fees per brand eat margin |
| Risk | Dev effort is yours | Becomes a second system to maintain | Cannot white-label or meter AI |

Reasoning: the product is the multi-tenant layer (config, KB, guardrails, metering, connectors). n8n would still need a custom admin and Supabase, so it adds a runtime without removing work. Helpdesks assume a human team, and you have 1 person on email. If time slips, n8n is acceptable only as a throwaway prototype of the webhook flow, never as the tenant runtime.

## Multi-tenant model
One Supabase project, shared schema, `tenant_id` on every row, Postgres RLS. Admin users map to tenants via `memberships(role: owner/admin/viewer)`.

Tables: `tenants`, `tenant_config`, `channels` (IG/FB tokens, encrypted), `kb_documents`/`kb_chunks` (pgvector, tenant-scoped), `conversations`, `messages`, `handoffs`, `addon_installs`, `usage_events`.

`tenant_config` (JSONB, versioned, validated by a zod schema):
```
tone: {preset: formal|friendly|playful, custom_notes}
languages: {default: "es-MX", enabled: ["es","en"]}
policies: {never_do[], escalate_always[safety, legal, human_request], return_policy_text, hours, handoff_email}
sales: {crosssell_level: 0-3}        # pushiness knob
limits: {max_turns: 12, daily_conv_cap}
identity: {method: order_no+email}
knowledge: {source_ids[]}
addons: [{key:"shopify", status, creds_ref, settings}]
```
Guardrails not editable by brands: no invented answers (answer only from KB or tool result, otherwise handoff), no discounts/promos, read-only. Brands tune tone and policies, never safety rules.

## Add-on / plugin architecture
A **connector interface** in code: `{key, configSchema, tools[], healthCheck(), onInstall()}`. Each add-on exposes typed tools to the LLM (e.g. `shopify.get_order_status(order_no, email)`). The orchestrator loads only tools from the tenant's `addon_installs`. Core = Meta channels + KB + handoff. Shopify = add-on #1 (custom app token, read_orders scope only). Twilio = later channel adapter implementing the same `ChannelAdapter` (receive/send/normalize), so conversation logic is channel-agnostic. A new add-on is a folder plus a registry entry, not a rebuild.

## Meta: can a brand self-connect?
Yes, but with a prerequisite you must start **day 1**: your own Meta app needs Business Verification and App Review (Advanced Access for `pages_messaging`, `instagram_manage_messages`, Business Login). Review typically takes 1-4 weeks (assumption, verify). Until approved, the app works only for people with roles on the app (Chefman admins can be added as testers), which is enough for the Chefman MVP. After approval, brands self-serve via OAuth, token stored per tenant, long-lived page tokens refreshed by cron. Risk: review rejection delays brand #2, not Chefman. Also 24h messaging window applies (no proactive outreach, consistent with the brief).

## Onboarding in days
Checklist wizard: (1) sign up and create tenant, (2) connect Meta via OAuth, (3) pick tone and languages, (4) fill store info/policies, (5) upload files (PDF/manuals auto-chunked and embedded), (6) optional Shopify add-on, (7) test chat sandbox, (8) go live toggle. Target: under 1 day of brand effort plus 1-2 days of your review of the first conversations. A tenant template (Chefman config, cloned) seeds brand #2.

## Cost per conversation (OpenAI)
Assumptions (verify current prices): small-tier model such as gpt-4.1-mini at about $0.40/M input, $1.60/M output. **Standard conversation** = 8 customer turns, hard cap 12, then forced handoff. Per turn: system+config 800 tokens, retrieved KB 1,200, history avg 1,000, user 60 = about 3,000 in, 150 out. Per conversation: about 24k in, 1.2k out = **about $0.012** (round to $0.015 with tool-call overhead and embeddings). With a mid-tier model (about $2/$8 per M) it is **about $0.06**. Prompt caching and history summarization could cut 30-50%.
At Chefman: 1,000 orders/mo, assume 30-60% of buyers write (unknown) = 300-600 conversations = **$5-$10/mo mini, $20-$40 mid-tier**. Fixed infra about $50/mo (Vercel Pro + Supabase Pro) shared by all tenants. Meta APIs are free.

## Pricing model
- **Platform fee** per brand per month (suggest $149-$249 USD, Shopify add-on +$49), covering setup, support, hosting.
- **Metered AI**: includes N conversations (e.g. 500), then per extra conversation at cost x2-3 (about $0.04 mini-tier; define "conversation" as a 24h thread capped at 12 turns). Show usage in the dashboard from `usage_events`.
- Margin is high; the real cost is your support time, so price for that.
- LFPDPPP and retention (30+ days, configurable per tenant) need a privacy notice and DPA template per brand.

## Monitoring (per tenant)
Conversations, resolved-without-human rate, handoff reasons, "unanswered/unknown" questions list (drives KB gaps and new add-ons), tokens and cost, p95 latency, Meta token health alerts, daily cost cap with auto-handoff.

## Open items
Shopify plan (affects API access), Meta review timeline, real contact rate, legal retention period.
