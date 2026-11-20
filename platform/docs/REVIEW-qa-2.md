# Browser QA + UX pass 2 (2026-11-20)

Build: git `main` at HEAD `70782bc`, `next dev` (Turbopack, Next 16.4.6) on port 3100.
Mode: SQLite, isolated temp `DATA_DIR` in the session scratchpad (deleted afterwards), demo seed (`scripts/seed-demo.mjs`, tenant `chefman`: 8 sections, 2 sources, 10 conversations, Shopify demo store). The AI and OpenAI keys were blanked, so the offline fallback was used and no paid calls were made. Login used throwaway QA test credentials kept in a scratchpad file. The real `platform/data` was not touched (its timestamps did not change).
Viewports: desktop 1440x900 and mobile 390x844, Spanish (default) and English (cookie `locale`).
Screenshots: `design/qa-2026-11-20/` (75 PNG). Naming: `{desktop|mobile}-{es|en}-{screen}[-state].png`.
Note: the brand test saved the amber theme *before* the mobile pass, so the app screenshots named `mobile-es-*` show the amber brand (this was on purpose, to check it on mobile). The brand was restored to the platform defaults afterwards (`desktop-en-brand-restored.png`).

**Totals: P0 = 0, P1 = 7, P2 = 30.**

---

## 1. What works (by screen)

- **Login**: native required-field validation; a wrong password gives a generic error ("Correo o contraseña incorrectos") with a lockout hint; `autocomplete` is set to username / current-password; redirects to `/dashboard`; Sign out returns to `/login`.
- **Dashboard**: 7-step checklist with clear states (Listo / Siguiente paso / Opcional). Only the next step uses a filled primary button. The links are right (step 4 goes to `/inbox?simulator=1`). The AI usage KPI shows "0% del tope mensual · se renueva el 1 dic". The demo banner is visible.
- **Inbox**: the list, search, status filters with counts, the platform filter (including "Simulador (pruebas)") and the empty filtered state ("No hay conversaciones con este filtro." + "Ver todas") all work. The waiting banner's "Ver quién espera" applies the filter (`aria-pressed=true`). The detail view shows "Motivo" and "Esperando". "Devolver al asistente" and "Marcar como resuelta" work and the counts update. A failed send keeps the draft. The mobile back button has `aria-label="Volver a la lista"`. The tab title shows the count ("(4) Social Inbox").
- **Simulator**: the starter chips work. `#1001` + `test@example.com` gives the demo order status (the email is masked as `t***@example.com` in the transcript). "mi licuadora echó humo" gives the correct safety script (911, unplug, out-of-hours note) and a handoff. `[Foto]` gives an acknowledgement and a handoff. "Garantía" answers from the context. "Empezar de nuevo" resets. Simulator chats are not counted as real customers (billing says so, and the counts confirm it).
- **Context**: progress bar (8/8). The Write/File switch is a real `radiogroup` with 44px labels. Uploading a `.txt` shows a preview of the parsed start of the file, "Reemplazar/Quitar", and keeps the written text as a draft. Linked sources show a count on the summary and persist. Text edits enable the sticky "Guardar cambios" bar ("Tienes cambios sin guardar" then "Guardado") and persist across a reload. There is no false leave-page prompt after saving.
- **Tone**: the slider (keyboard arrows) and the 1-5 buttons update the live preview at once. The ES/EN preview toggle works. Save persists (tested level 1, 2 and 4; restored to 4).
- **Sources**: local `.txt` upload goes to "Listo" right away. The delete dialog has a good title (`¿Eliminar «qa-otros-datos.txt»?`), focuses "Cancelar" first and closes on Escape.
- **Channels**: the Telegram token field is `type=password` with `autocomplete=new-password`. `123:abc` is rejected locally (server action `isTelegramBotToken`, no network call) with a clear Spanish message. The WhatsApp form opens with "¿Dónde encuentro esto?" help, and Cancel works. Nothing was submitted to Meta.
- **Add-ons (Shopify demo)**: the test lookup works for `#1001` + `test@example.com`. A wrong email and an unknown order give the same "No encontramos ese pedido…" message (no enumeration).
- **Brand**: hex fields have labels. Logo upload previews. The contrast checker adapts: in the amber theme the button text turns dark at 8.5:1 and the link color is darkened to 4.8:1. Save re-themes the whole shell (sidebar active item, buttons, chips, bubbles, focus ring). Reset + "Quitar logo" + Save restores the defaults.
- **Billing**: the usage numbers are clear and use es-MX formatting (2,000,000). The "not charging yet" banner is honest.
- **Team (SQLite)**: shows the admin and explains the roles. It is clearly read-only.
- **/platform (platform admin)**: the KPIs, the search, an empty result ("No business matches …"), the privacy footnote, and the table in its own scroll container on mobile all work.
- **Public pages** (`/`, `/precios`, `/privacidad`, `/terminos`, `/eliminar-datos`): all send `noindex, nofollow, nocache`, have `lang="es"`, show no horizontal scroll at 390px, and carry clear "Borrador" banners.
- **Keyboard**: a skip link ("Saltar al contenido") comes first, and every control has a visible 2px focus outline (also in amber).
- **Mobile**: no horizontal page scroll on any screen. Nearly every control is at least 44px (exceptions are listed below).
- **English**: no Spanish leaks in the UI chrome on any app screen (only the stored conversation and context data is in Spanish, as expected).
- **Console / server**: no page errors and no React errors. The only console error is the expected 502 of the demo reply (see P1-2). The dev server log has no stack traces or 5xx other than that.
- **Agent role**: it is not possible to create an agent locally in SQLite mode (invites are Supabase-only and `set-password` only manages the admin). I covered it with `src/e2e/roles.e2e.test.ts` and `src/components/__tests__/guards.test.ts`: 13/13 passed.

---

## 2. Bugs

### P0 (blocks use)
None found.

### P1 (should fix)

**P1-1 · Channels / Telegram: false "bot saved" message on a fresh tenant**
- Steps: open `/channels` on a tenant with no Telegram bot and `PUBLIC_URL=http://localhost:…`.
- Expected: an explanation that a public HTTPS address is needed, with no claim that a bot exists.
- Actual: "…El bot quedó guardado; cuando tu equipo técnico configure la dirección, toca «Volver a registrar webhook»." That button does not exist in this state, and no bot was saved.
- Screenshot: `desktop-es-channels.png`
- File: `src/app/(app)/channels/ChannelsClient.tsx:228` reuses `tg.needsHttps` when `!connected`. Add a separate key in `src/app/(app)/channels/dict.ts`:
  - ES: "Para recibir mensajes, Telegram necesita una dirección pública con HTTPS. Puedes pegar el token ahora; cuando tu equipo técnico configure la dirección, el bot empezará a recibir mensajes."
  - EN: "To receive messages, Telegram needs a public HTTPS address. You can paste the token now; once your technical team sets up the address, the bot will start receiving messages."

**P1-2 · Inbox: replying to demo conversations always fails**
- Steps: in the demo data, open "Andrea Soto" and send a reply.
- Expected: the takeover flow (status "Con una persona", reply shown) can be shown in demo mode, or the composer says up front that it will not send.
- Actual: "Este canal no está conectado. Revisa Canales." and `POST /api/inbox/conversations/:id/reply` returns **502**. The status does not change, so the core "take and reply" story cannot be demoed.
- Screenshot: `desktop-es-inbox-reply-result.png`
- Files: the reply API route under `src/app/api/inbox/conversations/[id]/reply`, `src/lib/channels/send.ts:137`, `src/lib/demo`.
- Fix: for demo-seeded conversations, store the agent message locally without sending, and show "Conversación de demostración: tu respuesta se guarda aquí, pero no se envía a nadie." Return 409 rather than 502 when a channel is not connected.

**P1-3 · Mobile inbox: the composer and the conversation are below the fold**
- Steps: at 390x844 open any conversation, or "Probar mi asistente".
- Expected: on mobile, the conversation view replaces the page header, waiting banner and filter card, with a sticky composer.
- Actual: the header, the "Probar" button and the waiting banner stay on top (about 400px). The reply box and the simulator input end up about 1,240px down the page (the simulator input measured at y≈1237).
- Screenshots: `mobile-es-inbox-conversation.png`, `mobile-es-simulator.png`
- File: the inbox client layout (`src/app/(app)/inbox/…`). Below `md`, hide the page header, banner and filters while a conversation is open, and make the composer `sticky bottom-0`.

**P1-4 · Channel availability is described three different ways**
- Public home: "WhatsApp · Próximamente", "Instagram · Próximamente", "Messenger · Próximamente" (`desktop-es-public-home.png`).
- Billing Pro plan: "Telegram, y WhatsApp cuando esté listo".
- `/channels`: active filled "Conectar" buttons with full forms for all three (`desktop-es-channels.png`, `desktop-es-channels-whatsapp-form.png`).
- Expected: one source of truth. Either label the three Meta cards in `/channels` "Próximamente" with a secondary "Avísame", or update the marketing and billing copy.

**P1-5 · Add-ons / Shopify demo: no way to connect a real store**
- The badges say "Modo demostración" and "Conectado" side by side. The banner says "Conecta tu tienda para activarlo", but the only action is "Desconectar".
- Screenshot: `desktop-es-addons.png`
- Expected: a single badge "Demostración" and a primary "Conectar mi tienda" button. Keep "Quitar demostración" as a secondary or text action.
- File: `src/app/(app)/addons/…`

**P1-6 · Inbox: safety cases look the same as ordinary handoffs in the list**
- "mi licuadora echó humo" (Andrea Soto) gets the same pink "Necesita a una persona" pill as "quiero hablar con alguien". "Motivo: reportó un problema de seguridad" appears only after opening the conversation, and the dashboard does not single it out either.
- Screenshots: `desktop-es-inbox.png`, `desktop-es-inbox-urgent-open.png`
- Expected: an "Urgente · seguridad" pill (red, with an icon), always sorted first, and counted separately in the banner. Suggested banner copy: "4 clientes esperan a una persona · 1 urgente".

**P1-7 · Legal pages are not publishable as they are (Meta app review, LFPDPPP)**
- `/privacidad`, `/terminos` and `/eliminar-datos` contain "(razón social por definir)" and have no contact email or form. `/eliminar-datos` only says "Pídelo al negocio".
- Screenshots: `desktop-es-public-privacidad.png`, `desktop-es-public-eliminar-datos.png`
- Expected: a legal entity name, a contact email (`mailto:`), and a direct way for the platform to receive deletion requests, before these URLs go into the Meta app settings.

### P2 (polish)

1. **Dashboard: "Esperan a una persona" and the inbox banner disagree.** The dashboard showed 5 and the inbox banner showed "4 clientes esperan…". The dashboard adds `needs_human + human` (`src/app/(app)/dashboard/page.tsx:70`). Either count only `needs_human`, or rename the card to "Con una persona o esperando". (`desktop-es-dashboard.png` vs `desktop-es-inbox.png`)
2. **Dashboard: "Atendidos por el asistente: 0" is ambiguous** while several resolved conversations were handled by the bot. Rename it to "Con el asistente ahora".
3. **Dashboard: the KPI cards are about 160px tall and mostly empty.** On mobile the four stacked cards push the checklist below the fold. Use a 2x2 grid on mobile and a smaller height. (`mobile-es-dashboard.png`)
4. **Simulator: the first reply has two openers.** Actual: "¡Hola! Soy Chef. ¡Perfecto! Para verificar, ¿me pasas el correo…?" Suggested: "¡Hola! Soy Chef. Para revisar tu pedido #1001, ¿me pasas el correo con el que hiciste tu compra?" (greeting composition in `src/lib/engine`)
5. **Order status grammar.** Actual: "Tu pedido #1001 está: Enviado." (`src/lib/engine/templates.ts:104-105`, `src/app/(app)/addons/dict.ts:69`). Use a status phrase map: "Tu pedido #1001 ya va en camino." / "…está en preparación." / "…ya fue entregado."
6. **ISO dates in customer replies.** Actual: "Entrega estimada: 2026-10-12." Suggested: "Entrega estimada: 12 de octubre." (format with `es-MX`, `day: numeric, month: long`).
7. **The add-on test preview is not what the bot actually says.** The preview uses "Guía:" / "Seguimiento:" and drops the order number, while the bot says "Número de guía:" / "Rastreo:". The preview is labeled "El asistente diría:", so it should reuse the engine template. (`desktop-es-addons-lookup.png` vs `desktop-es-simulator-order1001.png`)
8. **Photo acknowledgement gender and repetition.** Actual: "Recibimos tu foto, gracias. Una persona lo va a revisar. … Apenas abramos, una persona te responde por aquí." (`src/lib/engine/media.ts:68-69`). Suggested: "Recibimos tu foto, gracias. Alguien de nuestro equipo la va a revisar." Use `la`/`lo` according to the media noun (foto / nota de voz / video).
9. **Simulator after a handoff:** the input and chips stay enabled but nothing answers ("…así que ya no responde"). Disable them and make "Empezar de nuevo" the primary button.
10. **Desktop simulator panel:** at 1440x900 the composer and chips are below the fold, and the panel is narrower than its column (`desktop-es-simulator.png`). Make it fill the column at full height with a sticky composer.
11. **Reply-error status code:** a channel that is not connected returns HTTP 502 and leaves an error in the console. Use 409 or 422 (also noted in P1-2).
12. **Telegram validation error placement:** the error shows above "Cómo se conecta", far from the field, and the input has no `aria-invalid` or `aria-describedby` (`desktop-es-channels-telegram-invalid.png`). Render the error under the field and link it.
13. **Channels has four filled primary buttons** (three "Conectar" plus "Conectar y probar"). Make the Meta "Conectar" buttons secondary (see also P1-4).
14. **Repo path in customer UI:** "Guía completa: docs/GO-LIVE.md." (`channels/dict.ts:78, 157`). Replace it with a help-center link, or drop it.
15. **Context: mixed save models.** Text needs "Guardar cambios", but file uploads and linked sources save instantly ("Fuente quitada de esta sección."). Add the hint "Se guarda al instante" next to "Complementar con fuentes de datos" and to the file mode.
16. **Context label jargon:** "Usando: texto" / "Usando: archivo {name}" (`src/lib/context/dict.ts:43-44`). Suggested: "El asistente usa: lo que escribiste" / "El asistente usa: el archivo {name}".
17. **Context: the sticky save bar intercepts clicks near the bottom of the viewport.** Playwright hit "fixed bottom-0 … intercepts pointer events" on the last card's source checkbox. Add `scroll-padding-bottom` or a `scroll-margin` equal to the bar height.
18. **Tone slider accessibility:** there is no `aria-valuetext` (the screen reader reads "1…5" without a meaning), and the track is 12px tall on mobile. Add `aria-valuetext="Nivel 4 de 5: amigable"`.
19. **Amber brand: the tone slider's unfilled track turns near-black** instead of a light neutral (`desktop-es-amber-tone.png`). Probably the track uses the accent color: use `--line`.
20. **Amber brand: the "Nivel 4 de 5" chip text** (rgb 149,104,38 on an amber tint) measures about 4.3:1, below AA 4.5 for 14px text. Use the darkened ink token on the tint.
21. **Brand copy contradiction:** the field is called "Nombre que ven tus clientes" and the preview shows a customer chat widget, but "Dónde se ve tu marca" says only the team panel. Either rename the field to "Nombre del negocio en tu panel", or explain where customers see the name (the bot's signature).
22. **Brand: the `input[type=color]` swatches have no accessible name** (only the hex fields do). Add `aria-label="Color principal"`, etc.
23. **Team, signup and billing expose internals or dead ends.**
    - "Invitar personas estará disponible cuando la app use Supabase." becomes "Pronto podrás invitar a tu equipo desde aquí."
    - "El registro estará disponible cuando la app use Supabase. Por ahora entra con la cuenta de administrador." becomes "Por ahora el registro está cerrado. Si ya tienes cuenta, entra aquí."
    - The role badge says "Admin" in Spanish: use "Administrador(a)".
    - "Para cambiar de plan, escríbenos." has no link or email.
24. **Billing counts the 10 demo conversations under "Cuentan las de clientes reales".** Exclude demo-seeded conversations, or label them "(incluye demostración)".
25. **AI unit naming is inconsistent:** "unidades" in billing vs "tokens" in `/platform`. Pick one: "unidades de IA".
26. **/platform: "Negocios registrados" changes with the search** (it shows 0 and "0 business(es)" for a query that matches nothing). Keep the total unfiltered, or rename it to "Resultados". There is also no link from the tenant shell to `/platform` for platform admins.
27. **Product name is inconsistent.** The browser tab says "Social Inbox" on the app and the login (`src/app/layout.tsx:5`, description "Customer chat assistant for Instagram, Facebook and WhatsApp"), but "Conversa" on the public site and `/platform`. Use "Conversa" everywhere (the tenant name can stay inside the shell).
28. **Login is bare.** There is no logo or product name, no language switch, no "¿Olvidaste tu contraseña?" (`/login/forgot` redirects to `/login` in SQLite mode; acceptable, but say so), and no link to the home page. `/login` and `/signup` lack `noindex`, unlike the marketing pages. The error message has no final period: "Correo o contraseña incorrectos." (`desktop-es-public-login.png`, `desktop-es-login-error.png`)
29. **Mobile navigation** is a horizontal strip of 11 items, with only about 3 visible and a visible desktop-style scrollbar (`mobile-es-dashboard.png`). Consider a bottom bar (Inicio, Mensajes, Probar, Más) or a menu sheet. The public footer links are 20px tall on mobile (below 44px).
30. **Demo seed polish:** Pablo Aguilar's reason says "pidió hablar con una persona" but his messages are photos; the delivery date 2026-10-12 is in the past; the dashboard subtitle "Deja tu asistente listo…" repeats the checklist title "Deja listo tu asistente".

Dev-only notes (not product bugs):
- The Next.js dev-tools badge (bottom-left) covers the "English" / "Español" button in the sidebar, so a pointer click fails in dev.
- `next dev` writes `platform/AGENTS.md` on every start ("✓ Generated AGENTS.md for AI agents"). It changed `# This is NOT the Next.js you know` to `## …`. Set `agentRules: false` in `next.config.ts`, or commit the generated file. **This QA run left that one-line change in the working tree** (reverting it was blocked by the permission policy); restore it with `git checkout -- platform/AGENTS.md`.

---

## 3. UX and copy replacements (summary)

| Where | Current | Replace with |
|---|---|---|
| Simulator / bot | ¡Hola! Soy Chef. ¡Perfecto! Para verificar, ¿me pasas el correo…? | ¡Hola! Soy Chef. Para revisar tu pedido #1001, ¿me pasas el correo con el que hiciste tu compra? |
| Bot order status | Tu pedido #1001 está: Enviado. | Tu pedido #1001 ya va en camino. |
| Bot ETA | Entrega estimada: 2026-10-12. | Entrega estimada: 12 de octubre. |
| Bot photo | Una persona lo va a revisar. | Alguien de nuestro equipo la va a revisar. |
| Context | Usando: texto | El asistente usa: lo que escribiste |
| Telegram (no bot yet) | …El bot quedó guardado; … «Volver a registrar webhook». | Para recibir mensajes, Telegram necesita una dirección pública con HTTPS. Puedes pegar el token ahora; cuando tu equipo técnico configure la dirección, el bot empezará a recibir mensajes. |
| Channels tech | Guía completa: docs/GO-LIVE.md. | (remove, or link to the help center) |
| Team | Invitar personas estará disponible cuando la app use Supabase. | Pronto podrás invitar a tu equipo desde aquí. |
| Signup | El registro estará disponible cuando la app use Supabase… | Por ahora el registro está cerrado. Si ya tienes cuenta, entra aquí. |
| Team role | Admin | Administrador(a) |
| Dashboard KPI | Atendidos por el asistente | Con el asistente ahora |
| Inbox banner | 4 clientes esperan a una persona | 4 clientes esperan a una persona · 1 urgente |
| Demo reply | Este canal no está conectado. Revisa Canales. | Conversación de demostración: tu respuesta se guarda aquí, pero no se envía a nadie. |
| Shopify demo | (only "Desconectar") | Primary "Conectar mi tienda"; secondary "Quitar demostración" |
| Login error | Correo o contraseña incorrectos | Correo o contraseña incorrectos. |

---

## 4. Not tested

- **Supabase mode**: signup, invitations, forgot and reset password, the agent role in the browser (covered only by unit and e2e tests), RLS, Storage buckets, and `/platform` with `public.platform_admins`.
- **Real integrations**: Telegram (only the local format validation; no `getMe` or `setWebhook`), Meta (WhatsApp, Instagram, Messenger connect; webhook signature; data-deletion `signed_request`), Shopify OAuth and real orders, and Anthropic or OpenAI replies (only the offline fallback ran, so the AI usage stayed at 0%).
- **Link sources**: adding a URL, and "Actualizar" on the demo link source, were not clicked (they would fetch `example.com`).
- **Onboarding**: `/onboarding` redirects to `/dashboard` because the tenant was already set up (`desktop-es-onboarding.png` shows the redirect).
- **Not exercised**: retention or purge, the handoff email outbox, rate-limit lockout after repeated failures (only one wrong password was tried), dark mode, and screen-reader runs (only the ARIA attributes were checked).

---

## Fix status (wave 4, fixer F2: UX + QA, 2026-11-19)

Scope: the inbox / channels / add-ons / dashboard / billing / brand / context / tone / team UI, login / signup / onboarding UI, the shell, the public site and `src/lib/platform/**`, plus the inbox route handlers. Engine copy, the demo seed and the `/platform` page belong to other owners (requests in `docs/REQUESTS.md`).

### P1 (7/7 fixed)

| # | Status | How |
|---|---|---|
| P1-1 | Fixed | New key `tg.needsHttpsNoBot` for a tenant with no bot (no claim that a bot was saved, no mention of the button). "Volver a registrar webhook" is only mentioned and shown once a bot is connected; agents get their own copy. |
| P1-2 | Fixed | `isDemoConversation` (`inbox/kinds.ts`): the reply route stores the agent reply (`meta.demo/notSent`), takes the conversation over and sends nothing. The thread shows "Esta conversación es de demostración: la respuesta se guarda pero no se envía a ningún canal." and a "Respuesta guardada…" confirmation. A channel that is not connected now answers 409. |
| P1-3 | Fixed | Below `md`, an open conversation or the simulator hides the page header, waiting banner and filters; the composer (thread and simulator) is `sticky bottom-0` with safe-area padding. |
| P1-4 | Fixed | `src/lib/platform/channels.ts` is the single availability source (Telegram available; WhatsApp, Instagram, Messenger "Próximamente"). The landing chips, billing copy and `/channels` read it. The Meta cards have no forms or connect buttons (a legacy connection can still be removed). The platform `META_VERIFY_TOKEN` and webhook settings are no longer rendered (security L7). |
| P1-5 | Fixed | Demo store: one badge "Tienda de demostración activa", primary "Conectar mi tienda real" (opens the connect form), secondary "Quitar demostración". |
| P1-6 | Fixed | Urgent = waiting with reason safety/legal: red "⚠ Urgente · seguridad/legal" pill, red left accent, sorted first, banner "N clientes esperan a una persona · 1 urgente", and a separate urgent line on the dashboard KPI. |
| P1-7 | Fixed (owner input still needed) | `brand.ts` holds owner-fillable `legalEntityName`, `privacyContactEmail`, `legalAddress` (+ optional `supportEmail`). Missing values render as highlighted "[Completar: razón social]" fields, every legal page shows a "Completar antes de publicar" notice, the contact becomes a `mailto:` link once set, and `/eliminar-datos` has a direct "Pedir la eliminación por correo" action. Draft banner and noindex unchanged. |

### P2 (24 fixed, 6 skipped)

| # | Status | Notes |
|---|---|---|
| 1 | Fixed | Dashboard, inbox banner/API and sidebar badge all read `loadInboxCounts`; the KPI counts `needs_human` only. |
| 2 | Fixed | "Con el asistente ahora". |
| 3 | Fixed | 2x2 KPI grid on phones, smaller cards. |
| 4 | Skipped | Engine greeting composition (F3). |
| 5 | Skipped | Engine order-status phrase map (F3). The add-on preview now reuses the engine template, so it follows F3's fix automatically. |
| 6 | Skipped | Engine date formatting (F3). Same note as 5. |
| 7 | Fixed | The add-on preview is `T.orderFound / orderNotFound / orderLookupError` with the tenant's tone and default language. |
| 8 | Skipped | Engine media copy (F3). |
| 9 | Fixed | After a handoff the simulator input and chips are disabled and "Empezar de nuevo" becomes primary. |
| 10 | Fixed | Simulator fills its column, taller log on desktop, sticky composer. |
| 11 | Fixed | 409 (not connected), 422 (window closed, bot blocked, chat gone), 429 (rate limited), 502 (other). |
| 12 | Fixed | Token errors render under the field with `aria-invalid` + `aria-describedby`. |
| 13 | Fixed | The Meta cards have no buttons; Telegram's "Conectar y probar" is the only primary. |
| 14 | Fixed | The technical Meta section (with `docs/GO-LIVE.md`) is gone. |
| 15 | Fixed | "Se guarda al instante" on the file mode and the data-source hint. |
| 16 | Fixed | "El asistente usa: lo que escribiste" / "…el archivo {name}". |
| 17 | Fixed | Bigger bottom padding plus `scroll-margin-bottom` on the context form controls. |
| 18 | Fixed | `aria-valuetext="Nivel 4 de 5: amigable"`; 44px slider hit area. |
| 19 | Fixed | `.range-brand`: filled `--brand`, unfilled `--line` (no browser-picked dark track). |
| 20 | Fixed | The level chip is ink on `--brand-soft` (AA-tested pair). |
| 21 | Fixed | The field is "Nombre de tu negocio en el panel", and "Dónde se ve tu marca" explains what customers see. |
| 22 | Fixed | Colour pickers have `aria-label`. |
| 23 | Fixed | Team and signup copy without "Supabase", "Administrador(a)", and plan change shows a `mailto:` when `supportEmail`/`privacyContactEmail` is set (otherwise "Pronto podrás cambiar de plan desde aquí."). |
| 24 | Fixed | Billing excludes demo conversations; the hint says so. |
| 25 | Fixed | "unidades de IA" in billing and in the `/platform` dict. |
| 26 | Skipped | `/platform` page layout and the shell link are outside F2's files (request filed). |
| 27 | Fixed | Root metadata comes from `PLATFORM_BRAND` (title template, description, noindex); no "Social Inbox" in `src/`. |
| 28 | Fixed | Auth screens show the platform logo and name, a home link and a language switch; local mode explains who resets passwords; `/login` and `/signup` are noindex; the error ends with a period. |
| 29 | Fixed | Phones get a "☰ Menú" button (44px) that opens the full navigation panel (Esc closes it, navigating closes it, a red dot shows waiting customers). Public footer links are 44px tall. |
| 30 | Partly fixed | The dashboard subtitle no longer repeats the checklist title. The demo seed items (Pablo's reason, past ETA) belong to `src/lib/demo` (request filed). |

Also changed: inbox Telegram filter (Telegram is now in the platform filter; the Meta options were removed), labels for `ai_cap_reached`, and send-error copy for `telegram_bot_blocked_by_user` ("El cliente bloqueó el bot; no podemos enviarle mensajes"), `rate_limited` and `telegram_chat_not_found`. The context, channels and simulator placeholders are generic (Chefman stays only in the demo data).

Tests added or updated: `src/e2e/inbox-demo.e2e.test.ts` (demo reply stored, nothing sent, 409, counts loader equals API, urgent count, cross-tenant negatives), `inbox/__tests__/kinds.test.ts`, `inbox/__tests__/send-errors.test.ts` (Telegram keys, HTTP statuses), `channels/__tests__/channels-client.test.ts` (no-bot copy, "Próximamente", no verify token), `lib/platform/__tests__/legal-channels.test.ts` (single availability source, legal markers and notice), `billing/__tests__/usage.test.ts` (demo excluded), and `src/e2e/takeover.e2e.test.ts` (window refusal is now 422).
