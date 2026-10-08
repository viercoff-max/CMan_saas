# 08 - Review and Top 2 (Proposal Reviewer)

## Verdict on the consensus
All six roles chose Option A, and for the long-term product they are right. But the agreement hides a schedule assumption that no one has checked: **real Chefman customers (people with no role on our app) reach our webhook while the app has only Standard Access.** 01, 05 and 07 say Chefman can go live "on app roles". 06 says that under Standard Access "only app role users (testers) can talk to the bot". Only 04 marks this as the single biggest risk and proposes a day-2 test. If that test fails, every plan that relies on a 2-week launch on Option A slips to the App Review timeline (04 cites reports of about 20 days per round, so budget 3-6 weeks). So the owner needs a second path that does not depend on Meta's approval.

## Proposal 1: Own platform, staged launch (consensus Option A, reduced scope)
**Summary:** we build the platform as designed in 04/07, but the first 2 weeks only cover what Chefman needs to go live. The onboarding wizard, the 6-screen admin and the clustering of unanswered questions wait until weeks 3-6.
**Architecture:** Next.js on Vercel. One Meta app with a signed webhook, idempotent on `mid`, routed by page/IG ID to the tenant. Supabase (RLS on `tenant_id`, pgvector, encrypted tokens). OpenAI small model. Order verification in code; the LLM only receives a templated status line (06). Shopify connector using a pasted token. Handoff emails through Resend.
**2-week scope:** IG and Messenger in/out; order status; RAG with a "no source means handoff" rule; deterministic escalation for safety, legal and human requests; rate limiting; email handoff that pauses the bot; ES/EN; a minimal admin (login, tone, store fields, uploads, conversation list with filters); privacy URL, data-deletion callback, first-message privacy notice, 30-day purge job. The full Meta OAuth flow and the onboarding wizard are deferred: Chefman is connected by hand.
**Timeline:** Day 1: start Business Verification, create the app, write the policy pages. **Day 2: test Live mode + Standard Access with a non-role account. If it passes, continue. If it fails, switch to Proposal 2's channel layer.** Days 3-11: build. Days 12-14: Chefman UAT, then submit for App Review.
**Cost:** about $50/mo of infrastructure plus $5-40/mo of tokens (07's figures, not verified). Developer time is the real cost.
**Risks:** the Meta access gate (high); scope creep (06's must-have list on its own fills about 2 weeks); handoff load on a single agent.
**Scores (1-5, 5 = best):** Impact 5 · Cost 4 · Time-to-launch 2 · Risk 2 · Multi-brand scalability 5.
**Backed by:** 01, 02, 03, 04, 05, 06, 07 (all six).

## Proposal 2: Our own "brain" first, on a borrowed channel, own Meta app in phase 2
**Summary:** for the first few months, an already-approved Meta tool (ManyChat or a similar Meta Business Partner) carries the DMs. Each brand connects its Page/IG to that tool in minutes without any App Review on our side. The tool forwards each message to our own API (an External Request or webhook), and that API does all the work: KB/RAG, guardrails, Shopify, handoff, logging, admin. Once our Meta app has Advanced Access, we replace the channel layer with our own `ChannelAdapter`. The brain stays as it is.
**Architecture:** same Supabase/OpenAI/Shopify/handoff core as Proposal 1. The vendor provides inbound/outbound, ice-breakers, quick replies and the inbox for the human agent. We still build our own Meta app in the background.
**2-week scope:** the brain API, Shopify, RAG, guardrails, handoff, a minimal admin, logging. The vendor flow is about 1 day of setup. Webhook signature checks, the Send API and Meta OAuth move to phase 2.
**Timeline:** Days 1-2: set up the vendor and send a test DM. Days 3-11: build the brain. Days 12-14: Chefman goes live with real customers. Business Verification and App Review run in parallel, and migration happens in weeks 4-8.
**Cost:** the same infrastructure and tokens plus a vendor fee per brand. ManyChat Pro is estimated at about $15-$65/mo depending on contact count (not verified). We also pay for the migration work later.
**Risks:** vendor limits (the External Request timeout may be around 10 s and could cut off RAG+LLM calls, which would need an async reply pattern; not verified); PII passes through one more processor, so it must be added to the DPA; brands see a third-party app in their Meta settings; switching vendors costs effort.
**Scores:** Impact 4 · Cost 3 · Time-to-launch 4 · Risk 4 · Multi-brand scalability 3 (rises to 5 after migration).
**Backed by:** no role proposed it as the main path. 04 notes that a vendor's already-approved app is "the fastest legal path", and 02 and 07 accept a throwaway prototype if Meta becomes the bottleneck. I am proposing it as the explicit fallback for the day-2 test.

**Recommendation:** start Proposal 1. Run Proposal 2's vendor setup in parallel on days 1-2, which costs about 1 day, so that a failed day-2 test does not cost a week.

## Conflicts between proposals
1. **Who can talk to the bot under Standard Access:** 01/05/07 say Chefman can launch on app roles, 06 says only role users can message the bot, and 04 says it needs a test. 07 also says a review delay "delays brand #2, not Chefman", which may be wrong.
2. **Where the human replies:** 03 has the agent reply in the Meta Business Suite inbox. 02 and 05 collect the customer's email and reply by email. 04 suggests the Human Agent tag (7 days), but that tag needs its own permission and approval, and 06 marks it as unverified. **Decide one path.** Replying in the inbox while the bot is also active needs a reliable pause or handover.
3. **Retention:** the brief says at least 1 month. 04 and 06 set the default at 90 days. 06 also wants verification logs kept for a shorter time.
4. **Identity attempts:** 2 (02), 3 (04/05), or 5 per 30 min plus lockout (06).
5. **Conversation unit and turn cap:** 10, 12, 8/12 or about 20 turns; "24h thread" vs "24h inactivity gap". This is the unit we bill on, so it needs one definition.
6. **Cross-sell scale:** 3-step (02/05) vs 0-3 (03/07).
7. **Volume estimates:** 150-400 (01) vs 300-600 (02/07) conversations per month. None of these are based on data.

## Assumptions not verified
- **Meta:** Live mode with Standard Access delivers DMs from non-role users; App Review takes 1-4 weeks (07) or 3-6 weeks (04); Business Verification needs a registered legal entity, which we have not confirmed we have.
- **Shopify:** 04 says no review is needed for custom apps. However, the customer email on an order is *protected customer data*, and Dev Dashboard / custom apps may also need to request access to it. Creating legacy custom apps from the Shopify admin may no longer be possible for new apps. The 60-day limit on `read_orders` will make older orders (warranty questions) come back as "not found": these need a handoff message, not a generic failure, or we request `read_all_orders`. The order-number format (prefix or `#`) also needs checking.
- **Cost:** the gpt-4.1-mini prices and the 3k-tokens-per-turn estimate come from memory, not from today's price list. Pricing of $149-249 per brand has not been tested with Chefman or brand #2.
- **Single support person:** with 300-600 conversations and 30-50% handed off, that is 90-300 handoffs a month (5-15 per business day) on top of current email. The "urgent within 2 business hours" target (03) has no backup person and no out-of-hours cover for safety cases.
- **2 weeks:** 04's plan includes OAuth, RAG, guardrails, a 6-screen admin and App Review prep. 06's must-haves add an audit log, the deletion callback, a DPA and a legal review of the privacy notice. Legal review is an external dependency that can block go-live.
- **KPI targets** (50-70% resolved without a human, under 2% wrong answers) have no baseline behind them.

## Questions for the owner
1. Do you have a registered company (RFC, legal documents) ready for Meta Business Verification this week? Who is the Meta admin for Chefman's Page and IG?
2. If the day-2 test fails, do you accept a vendor channel (Proposal 2, about $15-65/mo per brand) to keep the 2-week launch, or would you rather wait for App Review?
3. Where should the support person reply to customers: the Meta inbox or email? Is there a backup person for safety cases outside business hours?
4. What is Chefman's Shopify plan, and can the store owner create a Dev Dashboard app with access to order email data? Do we need orders older than 60 days?
5. Can a Mexican privacy lawyer review the privacy notice and DPA before day 12, or is go-live allowed while that review is still open?
