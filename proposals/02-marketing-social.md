# Marketing & Social Lead — Proposal (Chefman DM assistant)

## Recommendation (up front)
**Option A (custom code: Vercel + Supabase + OpenAI + own Meta app), built thin.** Option B only as a throwaway prototype if the Meta app review is the bottleneck. Do not buy Gorgias/Respond.io as the product: they are the competitor, not the foundation.

## Option comparison
| | A: Custom | B: n8n / helpdesk |
|---|---|---|
| Multi-tenant brand #2 | Native (tenant_id, per-brand config) | n8n: workflow per brand = copy/paste debt. Helpdesk: per-seat pricing, no white label |
| Tone/rules in a dashboard | Full control | Hard; config lives in nodes |
| Margin on resale | High (AI cost pass-through is clean) | Helpdesk fees eat margin |
| 2-week launch | Tight but feasible if scope stays: order status + KB + handoff | Faster on day 1, slower from day 30 |
| Risk | Meta App Review (see below) | Same Meta review risk, plus tool lock-in |

Assumption: the 2-week timer is mostly gated by Meta, not code. Start the app review/Business Verification on day 1.

## Customer journey (IG/FB DMs, Mexico)
1. **Entry points:** DM direct, "Enviar mensaje" button, click-to-message ads, story replies. Comments are ignored (owner decision); add a pinned/bio line "Escríbenos por DM para tu pedido".
2. **Greeting + language:** Spanish by default (Mexican, informal-polite, "tú"), switch to English if the user writes in English. Ice-breakers (up to 4 quick prompts): "Estatus de mi pedido", "Manuales y uso", "Info de producto", "Hablar con una persona".
3. **Identify:** ask for order number + email only when the intent is order status. Never ask earlier. Max 2 failed attempts, then handoff.
4. **Resolve:** status answer in 1-2 short messages with the carrier link. The KB answers manuals/product questions; if retrieval is weak, say "no tengo ese dato" and hand off. Never improvise.
5. **Handoff:** the single support person works by email in business hours, so the bot must (a) set expectations ("te respondemos por correo en horario hábil, L-V X a Y"), (b) collect an email + summary of the issue, (c) send it to support. Always escalate: safety (fire, burns, shock), legal/lawsuit language, explicit human request. Safety = immediate, with no cross-sell, no cleverness.
6. **Close:** satisfaction ping (👍/👎) as the primary quality metric, and log unanswered topics to feed the KB.

**24h window:** replies only within 24h of the customer's last message (human-agent tag is 7 days, but support is email so don't rely on it). Say plainly in the handoff message that the follow-up comes by email.

## Brand-voice configuration (dashboard)
- **Tone selector** with 4 presets, each with a Spanish sample so the brand sees the result before saving: *Cercano* (warm, 1 emoji max), *Profesional* (neutral), *Divertido* (playful, more emojis), *Premium* (sober, no emojis). Plus 1 free-text "palabras que SÍ/NO usamos".
- Store fields: brand name, shipping/returns policy, warranty, hours, support email, escalation topics.
- KB uploads (PDF manuals, FAQs). Show a "preview chat" so the brand tests before going live.
- Tone changes only style, never guardrails. Guardrails are platform-owned and not editable (no promos, no inventing, no medical/legal claims).

## Cross-sell rules (within Meta policy)
Meta Messenger Platform policy: promotional content is allowed only inside the 24h standard window and when the user initiated contact; no unsolicited promo after it. So cross-sell is **reactive and in-context only**, never outbound.
- **Pushiness dial per brand:** Off / Soft / Active. Default Soft.
- Soft = after a resolved order-status or manual question, one optional line ("¿Te cuento de la tapa antiadherente compatible con tu freidora?"), max 1 per conversation, only a product from the allowlist of compatible/accessory SKUs the brand uploads.
- Rules: never during complaints, delays, or safety; never in the 1st message; stop on any "no"; link to the brand's product page, never an invented price or discount.
- Measure: cross-sell link clicks (UTM) per brand. No external tracking required in the MVP.

## Product positioning (to sell to brands)
Pitch: **"Un asistente de DMs que resuelve el 'dónde está mi pedido' y las dudas de producto 24/7, sin inventar nada, y le pasa a tu persona de soporte solo lo que importa."**
- Buyer pain: a 1-person support team drowning in WISMO (where is my order) repeats.
- Differentiators: read-only (safe), guardrails by design, brand voice in 5 min, handoff by email (no new tool to learn), a monthly report with unanswered topics.
- Pricing frame: base fee per brand includes a standard bundle (e.g. N conversations/month, where a "conversation" = a 24h thread); overage billed at cost + margin. Shopify is a paid add-on; future add-ons (WhatsApp/Twilio, other platforms) as connectors.
- Proof first: Chefman's baseline numbers (% resolved without human, CSAT, top unanswered) become the case study for brand #2.

## Open questions / flags
- **Self-serve Meta connection:** yes, technically via Facebook Login for Business OAuth under *our* Meta app, but it requires **Advanced Access** (App Review + Business Verification of our company) for the pages we don't own. Until approved, brand #2 works only as testers/roles on our app. Start now.
- Mexican privacy law (LFPDPPP): privacy notice link in the first message, with retention (1 month min) agreed with the client.
- Assumption: ~1000 orders/month implies ~300-600 DM conversations/month; unverified, so cap the plan at a standard length per conversation (e.g. 12 bot turns) before auto-handoff.
