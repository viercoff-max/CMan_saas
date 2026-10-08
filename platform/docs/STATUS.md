# Social Inbox: status for the owner (2026-10-05)

A chat assistant for Chefman (first brand) on WhatsApp, Instagram and Messenger. It runs on one computer today
(Next.js + a SQLite file). The admin panel is in Spanish, with an English toggle.

## What is built (by screen)
- **Login**: email + password. After 5 wrong tries for one email, or 10 from one IP, in 15 minutes, login is blocked for a while.
- **Dashboard (Inicio)**: a step-by-step setup checklist (context, tone, sources, add-ons, channels, test). The sidebar shows a red badge with the conversations waiting for a person. Test chats from the simulator are not counted.
- **Contexto**: 8 sections (business, products, shipping/returns, warranty, FAQ, escalation rules, do's and don'ts...). Saving one re-indexes it, so the bot uses it straight away.
  - Each section has a switch **Escribir | Usar un archivo**. With a file (PDF, DOCX, TXT, MD, CSV, HTML, max 10 MB) the
    assistant reads the file INSTEAD of the typed text; the typed text is kept as a draft. The card shows the file name,
    size, a preview of the first ~400 characters, "Reemplazar" and "Quitar" (with a confirmation). If the file cannot be
    read, the card shows an error badge and the assistant keeps using the typed text.
  - **Complementar con fuentes de datos** (per section, collapsible): tick existing Sources or paste a link ("Agregar
    enlace" creates the source and links it). Linked sources are indexed as part of that section; for "Qué sí y qué no
    decir" and "Cuándo pasar con una persona" their text goes into the assistant's rules (max 20,000 characters per
    section, cut with a note). Each card shows "Usando: texto | archivo X · +N fuentes".
  - Code: `src/lib/context/section-repo.ts` (`getEffectiveSectionContent`), `section-index.ts`, route
    `/api/context/section-file`, additive DB migration in `src/lib/db.ts` (`runMigrations`), test
    `src/e2e/section-context.e2e.test.ts`.
- **Fuentes (Sources)**: upload PDF/DOCX/TXT files or add web links. The bot answers from these too. Files uploaded
  inside a Context section are not listed here; sources linked to a section show an "En Contexto: ..." badge, and
  deleting or refreshing a source also updates those sections.
- **Tono**: agent name, tone slider 1 (formal) to 5 (friendly) with a live preview, greeting/fallback text, language, cross-sell level (0 to 3), handoff email, business hours with time zone. Hours that close after midnight (for example 20:00 to 02:00) work. A brand that never saved hours sees the default Mon to Fri 9 to 18 marked "not saved yet".
- **Bandeja (Inbox)**: all conversations, refreshed every 4 s. Filters by status. "Take", "Return to bot", "Resolve". Agents can reply; the reply goes out on WhatsApp/IG/Messenger. Includes the **Simulator** ("Probar mi asistente") to chat with the bot as a customer.
- **Complementos (Add-ons)**: connect Shopify (OAuth, manual token, or the **demo store**), plus a test box to look up an order.
- **Canales (Channels)**: connect WhatsApp / Instagram / Messenger with an ID and an access token. The token is checked with Meta before saving. An account already connected to another brand is refused.
- **The bot (engine)**:
  - Answers only from your context and sources.
  - Gives order status only (number + email must match).
  - Hands off to a person on safety words (smoke, fire, burns, shock), legal words (PROFECO, abogado, demanda), a request for a person, refunds, cancellations, address changes, photos/voice notes, or when it does not know.
  - Blocks invented promos, links, "already refunded" claims, and numbers (durations, prices) that are not in your sources.
  - Limits order-guessing across conversations.
  - Masks customer emails in stored messages and handoff mails.
- **Handoff mail**: written as a text file in `DATA_DIR/outbox/`. Nothing is emailed yet.
- **Privacy tools**:
  - `npm run purge` (retention clean-up);
  - `npm run delete-customer`;
  - Meta data-deletion callback, plus a status page: `/api/webhooks/meta/data-deletion?code=...`.

## Verified vs. not verified
**Verified by automated tests** (`npm test`: 465 tests, all passing; `npx tsc --noEmit`: clean):
- engine rules;
- context to answers;
- order flow against the demo store;
- escalations and business-hours wording;
- human takeover and agent reply (with Meta faked);
- webhook signature, routing and dedupe;
- channel connect;
- security helpers;
- retention.

**NOT verified**:
- No click-through in a real browser. The new Context file/linked-sources UI (switch, upload, preview, multi-select,
  mobile layout) is covered only by server-side tests. Every screen, the 4 s polling, the mobile layout and the ES/EN toggle are untested by a person.
- No real Meta. App Review, real tokens, IG/Messenger endpoints, the 24 h window, and media messages are all untested.
- No real Shopify store. OAuth, the real order query and `read_all_orders` are untested.
- No real OpenAI. Answer quality, tone and obeying "don't invent" are untested.
- No real email delivery.
- The new security headers (next.config.ts) were not checked in a running server.

## Run it locally
1. `npm install`, then `npm run setup` (creates `.env.local` with random secrets and the admin login. It never overwrites an existing file).
2. `npm run dev` and open http://localhost:3000.
3. Log in with `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env.local`. Afterwards rotate the password with `npm run set-password -- <email>` and delete the `ADMIN_PASSWORD` line.
4. Optional: put `OPENAI_API_KEY` in `.env.local`. Without it the bot uses a simple offline answerer built on your context.

For real customers use production mode and the tunnel rules in `docs/RUNBOOK.md`: `npm run start:prod`, data outside OneDrive, and rotated secrets.

## Try everything without any external account
1. **Contexto**: fill in at least Warranty and Shipping, then save.
2. **Tono**: pick a tone and business hours, then save.
3. **Complementos**: click to connect the **demo store**. Orders `#1001` to `#1004`, email `test@example.com` (1001 shipped with tracking, 1002 not shipped yet, 1004 cancelled).
4. **Bandeja**, then **Probar mi asistente** (Simulator), and try these messages:
   - "¿cuánto dura la garantía?"
   - "¿dónde está mi pedido?", then "1001", then "test@example.com"
   - "mi freidora sacó humo" (urgent handoff)
   - "quiero hablar con una persona"
   - an English question
5. Simulator chats appear in the inbox with a SIM label. Try "Take", reply, and "Return to bot". They send nothing and are not counted on the dashboard.

## Demo mode
`npm run demo` fills the LOCAL database (tenant `chefman`) with fake data so every screen looks alive without Meta, Shopify or OpenAI:
8 context sections (indexed), the Chef agent (tone 4, hours Mon-Fri 9-18 Mexico City, Tone marked as saved), 2 sources
(one link, one file, both "indexed"), the Shopify demo store connected, and 10 conversations over the last 3 days on
WhatsApp/Instagram/Messenger (5 resolved by the bot, 4 waiting for a person including an urgent safety case, 1 already taken by an agent).
Transcripts are written by hand with the engine's own wording; nothing calls the engine or an LLM.
- `npm run demo -- --reset` removes only the demo rows (conversations `demo-*`, sources titled `[Demo] ...`, audit rows by actor `demo`) and restores the context, settings and Shopify state that existed before, unless you edited them since.
- Re-running `npm run demo` is safe: it refreshes the demo data and timestamps without duplicating anything.
- It refuses to run when `NODE_ENV=production` or `PUBLIC_URL` is not localhost/127.0.0.1. It never touches users, passwords or secrets.
- Code: `src/lib/demo/`, `scripts/seed-demo.mjs`, test `src/lib/demo/__tests__/demo.test.ts` (temp `DATA_DIR`).

## Known gaps / next steps toward production
- **Hosting (Vercel + Supabase)**:
  - Replace `src/lib/db.ts` + `src/lib/store.ts` and the module repos (`engine/repo.ts`, `engine/limiter.ts`, `channels/repo.ts`, `security/rate-limit.ts`, `retention/`) with Postgres plus row-level security on `tenant_id`.
  - Move uploads (`DATA_DIR/uploads`) to Supabase Storage.
  - Move secrets to a KMS.
  - Webhook dedupe and rate limits must move to the database or the edge (today they are safe for one process only).
- **Handoff email**: send through SMTP/Resend to the Tone handoff email (`src/lib/channels/handoff.ts`), not just the outbox file.
- **Meta**: App Review and permissions, a Business verification, message templates for replies after 24 h, and a privacy policy URL plus the data-deletion URL above.
- **Legal (Mexico)**: an aviso de privacidad (LFPDPPP), a DPA with OpenAI (and zero-retention if possible), and terms with each brand.
- **Shopify**:
  - One-click OAuth needs a self-authenticating `state` when the admin uses localhost but the callback arrives on the tunnel. Until then, use the manual token.
  - `customers/redact` webhook wiring.
  - `read_all_orders` approval for orders older than 60 days.
- **Security**:
  - Content-Security-Policy with nonces (skipped for now so Next keeps working).
  - File parsing in an isolated worker.
- **More brands**: onboarding is one tenant per brand today (seed). Still needed:
  - sign-up/invite flow;
  - per-brand Meta/Shopify OAuth;
  - billing;
  - an add-on registry so other brands can plug in stores other than Shopify (`src/lib/connectors/registry.ts` is the hook point).
