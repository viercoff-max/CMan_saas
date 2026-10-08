# 05 - Conversation & UX proposal (Conversation Designer)

## Verdict on options
- **Option A (custom: Next.js on Vercel + Supabase + OpenAI, own multi-tenant Meta app):** best fit. The conversation is a small state machine plus RAG; tenant config (tone, store info, files) maps 1:1 to DB rows. Brand #2 = a new row, not a new workflow.
- **Option B (n8n or Respond.io/Gorgias):** n8n gets a demo quickly, but per-brand cloning of workflows, no real multi-tenant admin, and debugging 24h-window/webhook retries get painful. Helpdesks add per-seat cost, duplicate the "1 person by email" reality, and block our unanswered-question learning loop. Not recommended.
- **Assumption:** Meta App Review (advanced access for instagram_manage_messages / pages_messaging) takes the longest and may threaten the 2-week target. Start it day 1; the Chefman MVP can run in dev/standard mode with Chefman as app role-holder while review is pending. Self-serve OAuth (Facebook Login for Business) works for brands once the app is approved, so brands can connect themselves.

## Core flows (state machine, LLM only for language and knowledge answers)
1. **Greeting:** short, in brand tone, with quick replies: [Estado de mi pedido] [Preguntas sobre productos] [Hablar con una persona] [English].
2. **Language:** default ES; auto-detect English and offer a switch once; persist per user.
3. **Order status:** ask order number, then email (two separate steps). Match against Shopify read-only; on mismatch say "no encontré ese pedido con esos datos" (never reveal which field failed). 3 tries, then handoff. Show status and tracking link only. Anything beyond (address, changes, cancellations): send to the store site or handoff.
4. **Knowledge:** RAG over the brand's uploaded files and info fields. Answer only from retrieved passages, cite the manual name when possible. No source = fallback. Cross-sell at most one soft suggestion, gated by a per-brand "pushiness" slider (off / light / active).
5. **Fallback:** first miss: rephrase request + quick replies. Second miss: handoff. Every miss is logged as an unanswered question.
6. **Handoff (email, business hours):** triggers: explicit request, safety hazard (fire, burn, shock), legal language, 2 fallbacks, 3 failed identity checks. Bot collects name, email/phone, summary, then sends the transcript by email to the support person. Outside hours it states the next business-hour window. Safety/legal gets priority subject line and an immediate customer message advising to stop using the product.

## Sample dialogs (ES, "cercano" tone)
**Order**
- Cliente: Hola, donde esta mi pedido?
- Bot: ¡Hola! Con gusto te ayudo. ¿Me compartes tu número de pedido?
- Cliente: #10482
- Bot: Gracias. ¿Y el correo con el que compraste?
- Cliente: ana@correo.com
- Bot: Tu pedido #10482 va en camino. Salió el 28 de septiembre con Estafeta, guía 123456. Puedes verlo aquí: [enlace]. ¿Algo más?

**Knowledge**
- Cliente: ¿La freidora de aire sirve para hacer pan?
- Bot: Según el manual, está pensada para freír, hornear y recalentar; no menciona pan. Para no darte un dato incorrecto, ¿te paso con alguien del equipo? [Sí] [No, gracias]

**Safety**
- Cliente: Mi tostador echó chispas y humo.
- Bot: Lamento eso. Por tu seguridad, desconéctalo y no lo uses. Ya avisé a una persona del equipo; ¿me dejas tu correo para que te contacte? (Horario: L-V 9-18h.)

## Admin dashboard (one page-per-task, 6 screens max)
1. **Conexión:** "Conectar Instagram/Facebook" (OAuth button), status chip per channel.
2. **Tono:** 3 cards (Formal / Cercano / Divertido) with live preview message; pushiness slider; ES/EN default.
3. **Tienda:** fields: name, description, hours, support email, return/shipping policy, URL. Optional Shopify add-on card (connect token).
4. **Contexto:** drag-and-drop PDFs/TXT/URLs with processing status; delete/replace.
5. **Conversaciones:** list with filters (resolved / handed off / unanswered), transcript viewer, admin-only access, retention notice.
6. **Preguntas sin respuesta:** ranked by frequency, button "Agregar respuesta" (writes to knowledge base) or "Ignorar". This is the learning loop.
Plus a "Probar mi bot" test chat panel; also a small counters strip: conversations, % resolved without human, handoffs.

## Onboarding wizard (target 1-2 days)
Step 1 Conectar Meta (5 min) -> 2 Datos de tienda (15 min) -> 3 Subir manuales (30 min) -> 4 Elegir tono + probar (10 min) -> 5 Soporte humano: email and hours -> 6 Activar. Day 1 self-config, day 2 review of unanswered questions from test chats, then go live. Optional Shopify connect is a separate add-on step.

## Recommendation
Go with **Option A**, scoped small: one Next.js app, a tenant table, a fixed conversation state machine, pgvector RAG, and a connector interface (Shopify is the first plugin). Fix a standard "conversation" unit (e.g. 24h window or 10 AI turns) for billing. Review privacy notice wording and retention with the client under LFPDPPP (show a one-line notice on first message).
