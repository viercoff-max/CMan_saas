# Project brief (owner's answers) — Social DM assistant, first brand Chefman (Mexico)

Channels: Instagram DMs + Facebook Messenger only. Public comments: ignore.
Capabilities: READ-ONLY. Order status only (no address/items for now). Anything else -> customer does it on their platform or human handoff.
Also answers brand/company info, manuals, product info from a documented knowledge base (database). Strong guardrails: no invented answers, no discounts/promos created. Cross-sell allowed; pushiness must be configurable per brand.
Volume: ~1000+ orders/month; no conversation data. Launch target: 2 weeks (Chefman MVP).
Success: resolved without human; give correct info or hand off to human; track responses/unanswered to learn what solutions to add.
Identity: order number + email.
Human support: 1 person, by email, mostly Spanish, business hours. No helpdesk. Always escalate: safety hazards, legal/suing language, explicit request for human.
Languages: Spanish default, English switchable. Market: mainly Mexico (Mexican data privacy law LFPDPPP to review with client).
Meta: IG Business/FB Page connected: yes. Shopify plan: unknown. No external tracking tool (not for now).
AI: OpenAI/ChatGPT API (account exists). Retention: at least 1 month (to review with client/Mexican law); admin-rights users can view conversations.
Proactive outreach beyond 24h: no.
Business model: platform sold to brands; Chefman first, another brand interested. Monthly fee; extra costs (AI usage) passed to customer; need standard conversation length. Core product = Instagram/Facebook communication; Shopify is an ADD-ON; other add-ons per customer must be supported by the architecture (plugin/connector design). Twilio possible later for phone numbers (Telcel/AT&T non-prepaid) if a customer wants.
Brand onboarding: should take days, customer self-configures. Simple admin dashboard: tone selector, store info fields, upload context files. Open question from owner: can a brand connect its own Meta business directly (self-serve OAuth) or must developers do it first?
Stack available: Vercel, Supabase, OpenAI API. n8n was used before, not currently available (could be re-purchased if worth it). Owners maintain and support the platform.
