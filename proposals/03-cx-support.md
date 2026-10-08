# 03 - CX & Support Proposal (cx-support-lead)

## Recommendation (up front)
**Option A (custom code on Vercel + Supabase + OpenAI, own multi-tenant Meta app).** Reasons from the CX side: the product IS the conversation layer, so we must control guardrails, handoff payload, tenant config and the review loop. Buying Gorgias/Respond.io adds per-seat cost, a second inbox the single agent does not need, and does not solve brand #2 multi-tenancy or AI-cost pass-through. n8n (Option B) is fine for prototyping flows, but conversation state, per-brand prompts, retries inside Meta's 24h window and unanswered tracking become hard-to-test spaghetti; it also adds a paid dependency we would have to maintain. Assumption: a thin n8n use for non-critical side jobs (weekly digest) is optional, not required.

## Intents in v1
1. **WISMO / order status** (order number + email -> status, carrier, tracking link, estimated date). Read-only. Largest volume expected.
2. **Brand/company info** (hours, where to buy, shipping coverage, contact) from KB.
3. **Product info and manuals** (specs, usage, cleaning, "how do I use X") from KB; link/send manual.
4. **Returns, warranty, invoices, address changes, cancellations**: NOT executed. Reply with brand policy from KB + link to the self-service page, offer handoff.
5. **Cross-sell** (soft, config level 0-3 per brand; never invents discounts).
6. **Greeting/chitchat, out-of-scope, spam**: polite redirect.
Everything else = "I don't know" path (below).

## Escalation rules (hard-coded, not left to the LLM alone)
Deterministic keyword/regex layer + LLM classifier, either triggers:
- **Safety**: fire, smoke, burn, shock, explosion, injury, child hurt, "se quemó", "chispas", "humo", "choque eléctrico". Reply with brief safety instruction (unplug, stop use) from approved template, then immediate handoff flagged URGENT.
- **Legal**: demanda, abogado, Profeco, denuncia, "voy a demandar", fraud claims, data-rights requests (ARCO under LFPDPPP). No AI argument; empathetic ack + handoff.
- **Explicit human request**: "persona", "humano", "agente", "asesor".
- **Unanswered**: KB retrieval below confidence threshold, or 2 failed attempts (identity mismatch twice, repeated "no entendí"), or customer repeats/frustration signals -> offer handoff, do not loop.
- Angry/abusive sentiment -> handoff offered once.
Never promise a timeline the human cannot keep.

## Single-agent email handoff (no helpdesk)
On trigger, system sends one email to the brand's support address (configurable per brand), via Resend/SMTP from Vercel:
- **Subject**: `[URGENT|Normal] [Chefman] IG/FB - <reason> - <customer name> - #<case id>`
- **Body**: reason tag, language, last 10 messages transcript, AI summary (3 lines), order number + status if verified (flag verified yes/no), customer handle + deep link to the Meta inbox thread, what the bot already told them.
- **Reply path**: v1 = agent replies in Meta Business Suite inbox (links provided); email only notifies. Simplest and safe in 2 weeks. Reply-by-email relay is a v1.1 option (extra risk: threading, 24h window).
- Case row in Supabase (`handoffs`: status open/closed, timestamps); bot **pauses** for that thread while open, with a one-click "return to bot" link in the email. Reminder email if open > 2 business hours (Mon-Fri); admin sees open cases.
- Customer message on handoff: "Ya pasé tu caso a una persona del equipo. Te responden en horario hábil (L-V X a Y h, hora CDMX). Respuesta típica: < 1 día hábil."

## Out-of-hours
Bot keeps answering within its scope 24/7 (core value). For handoffs outside hours: say so explicitly, state next business-hours window, still email (urgent safety also sends a second flagged email/SMS-ready hook later). Hours + timezone + holidays configurable per brand. SLA targets (assumption, confirm with client): bot reply < 10 s; human first response < 1 business day; urgent < 2 business hours. Meta's 24h window means human reply after 24h may be impossible -> email says "window expires at HH:MM" and, if missed, fall back to asking customer to email.

## Guardrails against invention
- RAG-only for brand/product facts: answer strictly from retrieved KB chunks; if none above threshold -> "No tengo esa información" + handoff. No retrieval = no answer.
- Order data only from Shopify tool output; never guessed. Status text mapped from a fixed table.
- System rule: never create/offer discounts, coupons, refunds, delivery promises, medical/safety advice beyond template.
- Output validator: block replies containing %, $, "gratis", "descuento", promo codes not present in KB/tool data.
- Templates for sensitive replies (safety, legal, returns policy) rather than free generation.
- Identity: order # + email must both match before sharing any order data; never reveal which was wrong.
- Per-brand tone selector changes style only, never rules.

## Quality loop and unanswered tracking
- Log each turn: intent, KB chunks used, confidence, escalation reason, outcome (resolved / handed off / abandoned), thumbs ("¿Te ayudó?" quick reply after resolution).
- **Unanswered table**: every low-confidence/no-KB question stored, clustered weekly by topic -> top 10 gaps list; admin one-click "add answer to KB".
- Weekly review (30 min): sample 20 conversations + all handoffs + all negative ratings; score accuracy/tone/safety; fix KB or prompt. Golden test set (~50 real-style Q&A, ES/EN) run on every prompt change.
- KPIs: containment (resolved w/o human) target 60-70% after 4 weeks (assumption, no baseline), wrong-answer rate < 2%, handoff completeness, unanswered gap closure.
- Retention/privacy: store >= 1 month, mask emails in logs, admin-only access; LFPDPPP privacy notice link in first message (review with client).

## Replication for brand #2
Everything above is config per brand (hours, support email, policy text, tone, cross-sell level, escalation keywords additions, KB), rules engine shared.
