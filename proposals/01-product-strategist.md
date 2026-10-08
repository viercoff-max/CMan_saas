# Product Strategist Proposal: Social DM Assistant (Chefman first)

## Problem and users
Chefman customers in Mexico DM on IG/Messenger asking "where is my order?", product/manual questions and brand info. One support person handles email in business hours, so DMs wait. Goal: instant, correct answers in Spanish, with clean handoff when the bot should not answer. Secondary user: the brand operator who configures the bot. Tertiary: us, who sell it as a monthly platform.

## Key assumptions (verify early)
1. Meta App Review (instagram_manage_messages / pages_messaging, Advanced Access) and Business Verification are the real critical path, not code. Review can take days to weeks. **Mitigation:** while the app is in Standard Access, Chefman's admins can be added as app roles (admin/developer/tester), so Chefman can go live on our own app before approval. Brand #2 self-serve OAuth only works for arbitrary brands after Advanced Access. This answers the owner's open question: self-serve is possible but gated by review; until then we connect brands manually with them as app roles.
2. Shopify plan unknown. Order lookup via a Shopify custom app/Admin API token (read_orders) works on all paid plans, so we should not depend on the plan, but confirm that Chefman can create a custom app. Note: orders older than 60 days need the read_all_orders scope.
3. The 24h messaging window is fine because there is no proactive outreach.
4. Volume is about 1,000 orders/month. Expect roughly 150-400 DM conversations/month (a guess, no data), so cost per conversation is trivial; engineering time is the real cost.

## Options

**Option A: Custom code (Vercel + Supabase + OpenAI, own multi-tenant Meta app).**
Pros: the product *is* the asset we sell; per-brand config, guardrails, connector/add-on architecture and conversation viewer are native; no per-seat licenses; margin is ours. Cons: 2 weeks is tight; we own webhooks, retries, dedupe, signature checks, token refresh, admin UI.

**Option B1: n8n orchestration.**
Pros: fast first flow. Cons: n8n is not currently available (re-purchase), multi-tenancy is awkward (workflow-per-brand or heavy parametrization), poor fit for a self-serve dashboard, versioning and testing are weak, and we would still need Supabase and an admin UI. It saves roughly 3-4 days at the start and costs more at brand #2.

**Option B2: Buy a helpdesk (Respond.io, Gorgias, etc.).**
Pros: inbox, Meta integration and agents out of the box. Cons: per-seat/per-conversation fees, we are re-selling someone else's product with no moat, limited control over strict guardrails, and the owner wants a platform they sell. Also Chefman has one agent working by email, so inbox features are low value. Rejected.

**Option C (not needed).** A hybrid (n8n only for Shopify/add-on connectors) adds a moving part without clear benefit.

## Recommendation: Option A, with a deliberately thin MVP
Custom code, because the business model (multi-brand platform, add-on connectors, configurable behavior) is what you are selling, and low-code would be rebuilt by brand #2. De-risk the 2-week deadline by cutting scope, not by choosing low-code. Fallback if Meta approval stalls: run Chefman on app roles (see assumption 1).

## MVP scope (2 weeks, Chefman)
**In:**
- IG DM + Messenger inbound/outbound, one webhook, tenant resolved by page/IG ID.
- Order status by order number + email (both must match; never reveal anything else, no address/items).
- Knowledge base Q&A (RAG over uploaded docs/manuals/FAQ), answers only from sources; else "I don't know" and handoff.
- Guardrails: no invented answers, no discounts/promos, no actions; auto-escalate on safety hazards, legal language, explicit human request.
- Handoff = email to the support person with conversation summary and the customer's handle, plus a polite "we reply in business hours" message. Stop the bot for that thread.
- ES default, EN switch (detect, then follow customer language).
- Minimal admin: login, tone selector, store info fields, file upload, cross-sell level (off/soft), conversation viewer with an "unanswered / handed off" filter.
- Logging of every conversation/outcome (retention 1 month+, configurable, to confirm with Chefman under LFPDPPP; include a privacy notice message on first contact).

**Defer:** self-serve Meta OAuth onboarding, Shopify OAuth install (use pasted token), billing/metering UI, comment handling, Twilio/phone, proactive outreach, order items/address, analytics beyond the basics, multi-agent inbox, CSAT widget, add-on marketplace UI. Keep the connector interface (a `tools` registry per tenant) in the schema now so add-ons plug in later.

## KPIs
- **Resolution rate (no human):** conversations closed without handoff and without a "not helpful" signal. Target 50-60% by week 4.
- **Correct-handoff rate:** share of handoffs that are legitimate. Target above 90%. Hallucination incidents: 0 tolerated, reviewed weekly.
- **First response time:** under 10 seconds (bot); human handoff acknowledged instantly.
- **Unanswered-topic log:** top 10 questions the KB could not answer each week (this drives product roadmap and add-ons).
- **CSAT:** a lightweight thumbs 👍/👎 quick reply at conversation end (simple, no tooling).
- **Cost per conversation:** tokens and cost; define a "conversation" as a thread with a 24h inactivity gap and cap at about 20 bot turns (basis for pass-through pricing).

## Pricing and phasing
- **Phase 0 (wk 1-2):** Chefman live on app roles, Shopify via token, owners onboard manually.
- **Phase 1 (wk 3-6):** tune from real unanswered logs, Meta Advanced Access, brand #2 piloted with manual setup.
- **Phase 2 (month 2-3):** self-serve OAuth, Shopify OAuth, metering/billing, add-on connectors, Twilio if asked.
- **Pricing (proposal):** base monthly fee per brand covering IG/FB channel, KB and admin, plus an included bundle (e.g. 500 conversations), then overage priced at roughly cost x 2-3. Shopify as a priced add-on. Charge a one-time setup only if onboarding is assisted.

## Trade-offs and risks
Custom code is slower to first message than n8n, but cheaper to replicate. Biggest risks: Meta review delays, an unverified Shopify token scope, no baseline data (so KPI targets are guesses), and the single human agent as a bottleneck on handoffs. Keep email handoff templates tight to protect them.
