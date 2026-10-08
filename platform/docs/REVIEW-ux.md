# UX + conversation review (read-only audit)

Scope: `src/app/(app)/**`, `src/components/**`, `src/lib/context/dict.ts`, `src/lib/engine/{templates,escalate,index,orders,text,prompt}.ts`, `src/lib/channels/{meta,handoff,send}.ts`, webhook + simulator routes.
Requirement checked against: "very user-friendly, 1-button tasks, non-technical brand staff in Mexico, Spanish first, mobile friendly".
Line numbers refer to the files as read. Where I propose copy it is Spanish (Mexico, tuteo in the UI) with the English twin when the key already exists.

Verdict in one paragraph: the dashboard shell, Context, Sources and Inbox are close to the "one clear button per task" goal and the Spanish is clean and consistently tuteo. The weak points are (1) the Meta connection screen, which is a developer form; (2) the tone slider, which does not actually change greeting/no-answer/handoff wording once the form has been saved once, and only has 3 real registers instead of 5; (3) silent drops of non-text customer messages; (4) dark-mode contrast of primary buttons; (5) a number of leaked technical words ("fragmentos", ".env", "ngrok", "Meta 400: ...").

Counts: **P0 = 4, P1 = 22, P2 = 18.**

---

## P0 (blocks use)

### P0-1. Non-text customer messages are silently ignored (no reply, no queue entry)
- `src/lib/channels/meta.ts:71` (WhatsApp: only `m.type === "text"`) and `:87` (IG/Messenger: `if (!text.trim() ...) continue; // non-text ... ignored`). Webhook route then sends nothing.
- Problem: a customer who sends a photo of a burnt appliance, a voice note, a sticker, a location, or taps a reaction gets NO answer and the conversation never appears in the inbox. For an appliance brand the photo-of-the-defect and the voice note are the most common first messages, and the safety case (photo of a melted plug) is invisible to staff. Silence on a safety report is the worst possible outcome.
- Fix (code): in `parseMetaPayload` emit an inbound with `text: ""` and `attachmentKind: "image"|"audio"|"video"|"document"|"sticker"|"location"` (extend `MetaInbound`), and in `handleInbound` treat an empty text with attachment as `escalate(ctx, "human_request", "human_request", { intent: "attachment" })` after storing `body: "[Foto]"` / `"[Nota de voz]"` / `"[Ubicación]"` so staff see it. Reply with the attachment template below. Also add to docs: Instagram/Facebook comments are ignored (state it on the Channels cards, see P2-6).
- Replacement copy (new template `attachmentReceived`, tone-aware, no emoji below 5):
  - tone 1-2: "Recibimos su archivo, gracias. Una persona de nuestro equipo lo revisará y le responderá por este medio."
  - tone 3-4: "Recibimos tu archivo, gracias. Una persona de nuestro equipo lo va a revisar y te responde por este medio."
  - tone 5: "¡Recibimos tu archivo, gracias! 🙌 Una persona de nuestro equipo lo revisa y te responde por aquí."
  - English: "We received your file, thank you. A person on our team will review it and reply here."

### P0-2. Saving the Tone form freezes tú-style, tone-independent greeting and fallback text, so the 1-5 slider stops affecting them
- `src/app/(app)/tone/actions.ts:34-35` (`greeting = d.greeting || defaultGreeting(...)`, `fallbackMessage = ... defaultFallback(...)`), defaults at `src/lib/context/settings.ts:40-45` ("¡Hola! Soy el asistente virtual. ¿En qué te puedo ayudar hoy?" and "...Voy a pasar tu pregunta a nuestro equipo...").
- Engine consumers: `engine/index.ts:117-118` (greeting-only message uses `settings.greeting` whenever it is non-empty), `index.ts:224-226` (first-answer hello), `index.ts:246` (`fallbackMessage` replaces the whole no_answer/blocked handoff intro).
- Problem: the very first Save writes the default strings into the DB. From then on, a tenant at tone 1 ("usted", no emoji) greets with "¡Hola! ... te puedo ayudar" (tú, exclamations), never uses the agent name ("Soy el asistente virtual", the field "Nombre del asistente" is ignored), and the no-answer handoff is in tú at every level. The tone-aware `greeting()` and `handoffIntro()` templates in `templates.ts` become dead code. The hint on the field ("Si lo dejas vacío usaremos uno por defecto") is true only before the first save.
- Fix (code): in `saveToneAction` store the user's text only, never the default:
  ```ts
  const greeting = d.greeting;          // "" => engine uses tone-aware template
  const fallbackMessage = d.fallbackMessage;
  ...
  return { ok: true, greeting, fallbackMessage };
  ```
  and in `ToneForm.save()` keep `setV` as is. The engine already handles "" (`custom && ...` guards). Show the effective default as the textarea `placeholder` (generate it from `T.greeting(previewLang, v.toneLevel, v.agentName)`) so the user sees what will be used. Add a one-time migration: if `greeting === defaultGreeting("es"|"en")` or `fallbackMessage === defaultFallback(...)`, set to "".
- Also in the engine: when a custom greeting is set, the first-answer hello keeps only the first sentence (`index.ts:225`: `split(/(?<=[.!])\s+/)[0]`), so a custom "¡Hola! Soy Chef, tu asistente. ¿En qué te ayudo?" becomes only "¡Hola!". Use `T.shortHello` always for non-greeting first replies and reserve the custom text for the greeting-only case.

### P0-3. Channel connection is a developer form and asserts "Canal conectado" without testing anything
- `src/app/(app)/channels/ChannelsClient.tsx:87-94` (fields: `phone_number_id`, "Token de acceso", WABA id, "Token de acceso de la página") and `channels/actions.ts:31-36` (saves `status: "connected"` after only a regex/length check; no Graph API call), `dict.ts:15-24, 23-24` ("Canal conectado.", "Revisa los datos: faltan campos o son demasiado largos.").
- Problem: brand staff cannot find a `phone_number_id` or a page access token; they will paste the wrong value and be told "Canal conectado", then silently get no replies. The error message blames "campos faltantes o demasiado largos" although the schema also rejects ids under 3 chars, tokens under 10, and any id with characters outside `[A-Za-z0-9_.-]`. This is the single biggest "not 1 button" task in the product.
- Fix, level 1 (copy + validation, cheap): after saving, call Graph `GET /{externalId}?fields=name&access_token=...` (or `/me`), set status `connected` only on 200 and show `Conectado como {name}`; on failure show "Meta no aceptó estos datos. Revisa que el ID y el token sean de la misma cuenta y que el token no haya vencido." Rename fields in plain language with a "¿Dónde lo encuentro?" disclosure (see help copy below). Rename the button "Guardar y conectar" -> "Conectar y probar".
- Fix, level 2 (the real one-button task): "Conectar con Facebook" (Meta Facebook Login for Business / WhatsApp Embedded Signup). The form becomes a fallback under "Conexión manual (para tu equipo técnico)".
- Plain-language help to put under each field (new keys `h.whatsapp.id`, `h.token`, ...):
  - WhatsApp, ID del número: "Es un número largo que Meta asigna a tu línea de WhatsApp Business. Lo ves en business.facebook.com > Administrador de WhatsApp > Números de teléfono."
  - Token: "Es como una contraseña larga que permite al asistente responder en tu nombre. Pídele a quien administra tu cuenta de Meta que te lo genere (Usuario del sistema > Generar token). Nunca lo compartas por chat."
  - Instagram ID: "Es el número de tu cuenta de Instagram profesional. Se ve en Meta Business Suite > Configuración > Cuentas de Instagram."
  - Facebook ID de página: "Está en tu página de Facebook > Información > Transparencia de la página > ID de la página."
  - Extra button under the card: "Enviar instrucciones a mi equipo técnico" which copies a ready message ("Hola, necesitamos conectar [canal] al asistente. Datos que necesito de ti: ID de [..] y un token permanente. Pasos: ...").
- Also add a final one-button check after connecting: "Enviar mensaje de prueba" (sends "Prueba de conexión" to a number/the page admin) and show "Funciona" / "No pudimos enviar. Revisa el token".

### P0-4. Primary buttons are unreadable in dark mode (white text on bright teal), plus green/amber status text fails contrast
- `src/app/globals.css:14-18` dark `--brand: #2dd4bf` and `--danger: #ef6a5b`; `src/components/ui/index.tsx:91,94` (`bg-brand text-white`, `bg-danger text-white`); also `Sidebar.tsx:51`, `InboxClient.tsx:144` (chips), `InboxClient.tsx:199` (agent bubble), `Simulator.tsx:61`, `ToneForm.tsx:63,73,82`.
- Problem: white on #2dd4bf is about 1.8:1 (needs 4.5:1). Every main CTA, the active nav item, the unread-count badge, and the tone chat bubble become near-invisible for anyone whose phone is in dark mode (a large share of mobile users). Also `text-green-700` / `text-amber-700` status messages (`ContextForm.tsx:66-67`, `ToneForm.tsx:165`, `ChannelsClient.tsx:83`) on dark `--surface #161b22` are about 3.5:1.
- Fix (code): add tokens and use them instead of `text-white` wherever the background is brand/danger:
  ```css
  :root { --on-brand:#ffffff; --on-danger:#ffffff; --ok:#15803d; --warn:#b45309; }
  @media (prefers-color-scheme: dark) { :root { --on-brand:#04211e; --on-danger:#2a0a06; --ok:#4ade80; --warn:#fbbf24; } }
  @theme inline { --color-on-brand: var(--on-brand); --color-on-danger: var(--on-danger); --color-ok: var(--ok); --color-warn: var(--warn); }
  ```
  then `text-white` -> `text-on-brand` / `text-on-danger`, and `text-green-700` -> `text-ok`, `text-amber-700` -> `text-warn`. (Badges use light backgrounds with dark text and are fine in both themes.)

---

## P1 (should fix)

### Conversation quality

**P1-1. Out-of-hours handoff for a safety case says "respondemos cuando abramos"**
- `templates.ts:241-245` `handoffWhen` is used for every reason, including safety (`index.ts:247`).
- Problem: a customer who just reported smoke/shock gets "Estamos fuera de nuestro horario... Una persona te responderá en cuanto abramos." That reads as "we will deal with it on Monday". Same for legal.
- Fix: add a `kind` argument; for safety/legal use:
  - es (tú): "Marcamos tu caso como urgente. Una persona de nuestro equipo lo revisará lo antes posible{ fuera de horario: ", a más tardar en cuanto abramos ({h})" }. Mientras tanto, por favor no uses el aparato."
  - es (usted): "Marcamos su caso como urgente. Una persona de nuestro equipo lo revisará lo antes posible... Mientras tanto, por favor no utilice el aparato."
  - en: "We have marked your case as urgent. A person on our team will review it as soon as possible. Please do not use the appliance in the meantime."
  Never promise "en breve" (`templates.ts:246`) for normal cases when the queue could be long; use "lo antes posible" for both open and closed hours.

**P1-2. Safety message is good; 911 is correct for Mexico; three small improvements**
- `templates.ts:183-189`. 911 is the single national emergency number in Mexico (since 2017), so "llama al 911" is appropriate and should stay. The wording is calm, has no emoji or jokes at any tone, advises "si es seguro" and "no intentes abrirlo". Keep.
- Improve: (a) add one ask so staff get what they need: "Si puedes, compártenos el modelo del aparato y una foto del daño." (only valid once P0-1 is fixed); (b) put the emergency line first for fire/shock keywords. Suggested es-tú final text: "Lamentamos mucho lo ocurrido; tu seguridad es lo más importante. Si hay una emergencia o alguien está lesionado, llama al 911. Si es seguro hacerlo, deja de usar el aparato y desconéctalo de la corriente. No intentes abrirlo ni repararlo." (c) English variant is fine but "call 911" is only right for customers in Mexico/US; since the tenant is Mexico-only, acceptable. Have Chefman's legal/quality team approve this approved text once (it is brand-liability copy; the engine rule "no electrical advice beyond sources" is intentionally bypassed here).

**P1-3. Tone levels 1-5 do not really differ in the bot's own replies (3 registers, not 5)**
- `templates.ts:8-12` `reg()` maps 1,2 -> formal; 3 -> neutral; 4,5 -> warm. Emoji only at 5 (`emo`). Result: tone 1 == tone 2, tone 4 == tone 5 minus an emoji, and only `greeting()` (and see P0-2: it is bypassed after first save) and the LLM prompt (`prompt.ts:10-14`) vary per level. A customer cannot tell 3 from 4 in order/handoff messages.
- Fix (code): replace `r3` with a 5-slot picker and give levels distinct voices:
  ```ts
  const r5 = <T,>(t: Tone, v: [T,T,T,T,T]) => v[t - 1];
  ```
  Example for `askOrderNumber` (es):
  1. "Para consultar el estatus de su pedido, indíquenos su número de pedido, por favor. (por ejemplo, #1234)"
  2. "Con gusto le ayudo a consultar el estatus de su pedido. ¿Me podría compartir su número de pedido? (por ejemplo, #1234)"
  3. "Con gusto te ayudo a revisar el estatus de tu pedido. ¿Me compartes tu número de pedido? (por ejemplo, #1234)"
  4. "¡Claro! Te ayudo a revisar tu pedido. ¿Me pasas tu número de pedido? (por ejemplo, #1234)"
  5. "¡Claro que sí! 📦 Pásame tu número de pedido (por ejemplo, #1234) y lo checo en un momento."
  Do the same for askEmail, orderNotFound, clarify, handoffIntro (current warm versions are already fine for slot 4/5), offerDeclined. Rule of thumb to document in the file header: 1 = no "con gusto", no exclamations; 2 = courteous "con gusto/le agradezco"; 3 = tú, neutral; 4 = tú, exclamations, one friendly interjection, no emoji; 5 = casual Mexican ("ahorita", "va", "te late") and one emoji. Keep the guardrail: safety/legal/attempts ignore levels 4-5 flourishes (already true for safety).
- Also keep `prompt.ts:10-14` aligned (level 4 says "at most one emoji" but templates give none at 4, preview shows one: see P1-4).

**P1-4. Tone preview does not match what the bot will really say and contains claims the bot never makes**
- `context/dict.ts:92-96` (es) and `:235-239` (en) `tone.sample.N`: "Su pedido se encuentra en tránsito" / "su pedido va en camino" / "seguro ya anda en camino" before any lookup; level 4 has an emoji (😊) although real templates have none at 4; level 5 has "¡Holaaa! ... 🎉 ... 🚚✨" (real level 5 uses one emoji). These invent order status, violating "read-only / never invent", and train the owner to expect behavior the engine will not deliver.
- Fix (code): build the preview from the real templates so it can never drift: in `ToneForm.tsx:28` replace `dict[...]["tone.sample.N"]` with
  ```ts
  import * as T from "@/lib/engine/templates";   // templates.ts has no server-only imports
  const sample = [T.greeting(previewLang, v.toneLevel, name), T.askOrderNumber(previewLang, v.toneLevel)].join("\n");
  ```
  and show a second customer bubble "#1234" followed by `T.orderFound(...)` with a fake status so the user sees tone in the key moment. Keep the existing customer question bubble.

**P1-5. Safety keyword list over-triggers (and ignores negation), so harmless messages get the 911 text**
- `escalate.ts:7-16` (file lines): `fuego`, `humo`, `peligro`, `burn`, `fire`, `quemadura`, `se quemo`, `revento`, `smoke`, `danger`, `hurt`, `flame`.
- Problem examples: "¿La freidora no suelta humo?" / "no echa humo" (negated), "puedo cocinar a fuego medio" (not an appliance question, but "fuego" matches), "se me quemó el pollo" (cooking result, `se (le )?quemo`), "air fryer burn-in"/"smoke point of oil", "¿es peligroso lavarla?" (`peligro`), "revento" in "mi tarjeta se reventó" etc. A false positive tells a happy customer to call 911 and queues an urgent human case. In a brand context that is off-brand and trains staff to ignore the red badge.
- Fix (code): (a) skip a match when preceded by a negation within 3 words (`no|sin|nunca|ni|not|without|doesn't|never`), (b) drop `peligro\w*`/`danger\w*` to a "needs 2 signals" bucket (peligro + aparato/enchufe/corriente/cable), (c) restrict `se (le )?quemo` to "(el aparato|la freidora|el cable|el enchufe|se me quemo el|se quemo la resistencia)" or require appliance words, (d) for ambiguous words ask once instead of escalating: "Para ayudarte mejor: ¿el aparato echó humo, chispas o se calentó de más? Responde sí o no." Keep the current behavior for strong signals (llamas, chispas, descarga, incendio, intoxic*, "me quemé").
- Add test cases to `engine.test.ts` for the negated/cooking sentences above.

**P1-6. Refund/cancellation/address-change requests are not deterministic handoffs, but the Context screen promises they can be**
- `context/dict.ts:37-38` hint "Casos en los que el asistente debe llamar a un humano" with the example "o si pide un reembolso"; engine only passes that section to the LLM (`index.ts:173`), and the LLM is reached only when retrieval finds chunks (`index.ts:156-166`). With no hit, "quiero un reembolso" gets `clarify()` ("¡Ups! No encontré info sobre eso... el modelo del producto") and a second miss before handoff.
- Fix (code): add a fourth deterministic class `action_request` to `detectEscalation` for `reembols\w*|cancel(ar|e|o) (mi )?(pedido|compra|orden)|cambi(ar|o) (la )?direccion|devoluci\w*|refund|cancel my order|change (my )?address` -> handoff kind new `action_request`: "Eso lo gestiona una persona de nuestro equipo, así que te comunico con ella de inmediato." (usted/tú/warm variants). Update the hint to "Estos casos siempre pasan con una persona: seguridad, temas legales, reembolsos/cancelaciones y cuando el cliente la pide. Aquí agrega otros."

**P1-7. Greeting never tells the customer what the assistant can do**
- `templates.ts:19-36` and default `settings.ts:40-41`: "¿En qué te puedo ayudar hoy?". Customers on IG/WhatsApp type free text and often wrong things (comments, "precio?").
- Fix: end every greeting with the menu, e.g. es-tú: "¡Hola! Soy {n}, el asistente virtual de Chefman. Puedo ayudarte con el estatus de tu pedido, garantía, envíos y dudas de tus productos. ¿Qué necesitas?" (tone 1: "Buen día. Le atiende {n}, asistente virtual. Puedo apoyarle con el estatus de su pedido, garantía, envíos y dudas sobre productos. ¿En qué puedo ayudarle?"). Future: WhatsApp reply buttons / IG quick replies with the same three options (see P2-9).

**P1-8. Handoff email text exposes raw reason codes and has no real delivery**
- `src/lib/channels/handoff.ts:39` (`Motivo: ${p.reason}` prints `safety`, `no_answer`...), `:33-52` writes a `.txt` to `data/outbox/` only.
- Problem: the "handoff alert" promised on the Tone screen ("Aquí te avisamos cuando un cliente necesita a una persona", `context/dict.ts:78`) never reaches anyone locally; in production staff will see English codes.
- Fix: map reasons to the Spanish labels already in `inbox/dict.ts:28` ("seguridad", "tema legal", "pidió una persona", "sin respuesta disponible", "demasiados intentos", "asistente apagado"); subject `"[URGENTE] Un cliente necesita a una persona: seguridad (WhatsApp)"`; add the first 140 chars of the customer's last message. Until SMTP exists, show an honest line under the email field: "Por ahora los avisos se ven en Mensajes (aparece un número rojo)." and see P1-12.

**P1-9. The simulator creates real handoff notifications and pollutes the real inbox**
- `api/inbox/simulate/route.ts:124` calls `handleInbound` with channel `simulator`; `engine/index.ts:258` -> `notifyHandoff` (writes outbox/emails), `layout.tsx:30` badge counts it, `dashboard/page.tsx:16,24` counts it, and the list filter "Simulador" mixes it with customers.
- Problem: testing "mi freidora echó humo" (the first thing a careful owner will try) raises a red "1" in the sidebar, an `[URGENTE]` outbox file / email to the team, and a "Necesitan a una persona" count.
- Fix: in `notifyHandoff` return early when `conv.channel === "simulator"`; in `countConversationsByStatus` exclude `channel = 'simulator'` (or add a param); hide the simulator conversation from the default list (show only under the "Simulador" chip). Mark any simulator-generated outbox as `[PRUEBA]` if kept.

**P1-10. Simulator needs one-tap starters and screen-reader support**
- `inbox/Simulator.tsx:56-77`.
- Problems: empty state "Escribe un mensaje para empezar." makes non-technical staff think of what to type; the input has only a placeholder (no label); the message list has no `role="log"`/`aria-live`; the "…" busy indicator is not announced; reset is a text link with no confirm (fine) but small.
- Fix: replace the empty state with 4 tappable chips (each sends the text immediately, min-h 44px): "¿Dónde está mi pedido?", "¿Cuánto dura la garantía?", "Mi freidora echó humo", "Quiero hablar con una persona". Add `aria-label={t("sim.placeholder")}` to the input, `role="log" aria-live="polite" aria-relevant="additions"` to the scroll container, and replace `…` with `<span role="status">{t("sim.typing")}</span>` ("El asistente está escribiendo..." / "The assistant is typing..."). After the first reply show a small line "Así respondería tu asistente al nivel de tono {n}. Cambiar tono" linking to /tone (teaches the connection).

**P1-11. Dashboard: every unfinished step is a primary button; Tone never shows "Listo"; order is wrong; wording**
- `dashboard/page.tsx:20` (`done: false` hard-coded), `:42` (`variant={st.done ? "secondary" : "primary"}`), `:18-25` order, `:31` stats, `shell-dict.ts:7-11`.
- Problems: (a) with 5 steps open you see 5 teal "Abrir" buttons: no obvious "next". (b) Tone can never be completed. (c) "Abrir" is the same label for "start" and "review". (d) "Esperan a una persona" sums `needs_human + human` (`:30`), but `human` means a person already has it. (e) No "2 de 6" progress. (f) Order puts the technical Channels step (4th) before Shopify and the test (last), so non-technical users stall before ever hearing their assistant.
- Fix:
  1. Only the first undone step is `primary` with label "Empezar"; later undone steps `secondary` "Ir"; done steps `ghost` "Revisar". Add "{n} de 6 pasos listos" bar like `ContextForm.tsx:32-38`.
  2. `tone` done: add `toneConfigured` flag (or compare `agentName !== "Asistente"` / `updatedAt > createdAt`) set in `saveToneAction`.
  3. Order (build the thing, hear it, then go live): 1 Contexto, 2 Tono, 3 Fuentes, 4 Probar en el simulador, 5 Shopify (opcional), 6 Conectar canales ("Publicar tu asistente"). Rename step 6 label to "Conecta WhatsApp, Instagram y Facebook para empezar a atender clientes".
  4. Stats: card 1 = `needs_human` only ("Esperan una respuesta"), turn red and make the card a link to `/inbox?status=needs_human` when > 0; card 2 `bot` ("Atendidos por el asistente"); card 3 = `resolved`. Also label the period (e.g. "total").
  5. For brand-new tenants (all counts zero) hide the stats row until the first conversation; show a single welcome line instead.

**P1-12. Staff are not alerted when a customer needs a person (badge is not live)**
- `layout.tsx:30` computes `waiting` on the server at navigation time; `InboxClient.tsx:53` polls only while the Messages page is open. On any other screen or with the tab in the background nothing changes.
- Fix (low cost): a tiny client component in the layout that polls `/api/inbox/conversations?status=needs_human&limit=1` every 15 s, updates the sidebar badge, sets `document.title = "(2) Mensajes · Chefman"`, and optionally plays a short sound after the user clicks "Activar avisos". Also show a red banner at the top of /dashboard: "Hay {n} cliente(s) esperando a una persona." + button "Ver mensajes".

**P1-13. Inbox: wrong "loading" state, two-step takeover, raw Meta errors, no feedback on status actions**
- `InboxClient.tsx:131-135`: when `selected` is set but `thread` is still null (loading, or after a failed fetch) it shows "Elige una conversación para verla." which is false. Add a loading skeleton ("Cargando conversación...", `aria-busy`).
- `:210-223`: for a `needs_human` thread the only action is "Tomar conversación"; the reply box appears only after a second step. Because `reply/route.ts:21` already sets status `human` on first send, show the textarea for `needs_human` too and make "Responder" the primary (one button): keep "Tomar conversación" out. Hint under box: "Al enviar, el asistente deja de contestar esta conversación."
- `:158-162` `act()` ignores non-OK responses and shows nothing; on success there is no confirmation. Add a toast/inline status: "Conversación marcada como resuelta" / "Devuelta al asistente" with "Deshacer" (instead of a confirm dialog) and an error "No se pudo actualizar. Intenta de nuevo."
- `:169` `sendError` prints `d.detail` = raw `Meta 400: ...` (`send.ts:63`). Map: contains `24`/`window` or code 131047/10 -> "Pasaron más de 24 horas desde el último mensaje del cliente. Meta no permite responder; pídele que te escriba de nuevo."; `channel_not_connected`/`missing_token` -> "Este canal no está conectado. Revisa Canales."; 190/401 -> "El token de Meta venció. Vuelve a conectar el canal."; `timeout`/`network_error` -> "No pudimos conectar con {plataforma}. Intenta de nuevo en un minuto."; default -> "No se pudo enviar. Intenta de nuevo." Keep the raw detail only in `console`/a "Ver detalle técnico" disclosure.
- `:189-193` window banner: add the action: "Han pasado más de 24 horas desde el último mensaje del cliente. {platform} puede rechazar tu respuesta. Si no se envía, espera a que el cliente escriba de nuevo."
- `:195-206` messages have no timestamp. Show `HH:mm` under each bubble (and a day separator) so staff can tell how long a customer has waited.

**P1-14. Inputs are 14px, causing iOS Safari zoom on focus, and many targets are under 44px**
- `ui/index.tsx:117` `inputCls` uses `text-sm`; buttons `px-4 py-2 text-sm` (~36px), chips `px-3 py-1 text-xs` (`InboxClient.tsx:143`, ~26px), tone number bubbles `h-8 w-8` (`ToneForm.tsx:63`), preview-language toggles `py-1 text-xs` (`:73`), back link `text-sm` (`InboxClient.tsx:178`), file input.
- Fix: `inputCls`: `text-base md:text-sm` (16px on phones prevents zoom); `btn` md size `min-h-11 px-4 py-2.5`; chips `min-h-9 px-3.5 py-2` (or horizontal scroll row); tone number buttons `h-11 w-11`; back button as `Button variant="ghost"` with `min-h-11`.

**P1-15. Tone screen: slider is unclear; levels have no meaning**
- `ToneForm.tsx:48-65`, `context/dict.ts:51-54`.
- Problems: only "Más serio" ... "Más amigable" and "Nivel 3 de 5"; a user cannot predict "usted vs tú" or emojis; the numbered circles under the slider are `aria-hidden` and `tabIndex={-1}` (fine for keyboard, but mouse users hit 32px targets); slider has no `aria-valuetext`; dragging a native range on phones is imprecise.
- Fix: replace the range with a 5-option radio-card group (works with keyboard/touch, no drag), each card with a name + one-line effect, and put the live preview right below:
  1. "Muy formal" - "Trato de usted, sin exclamaciones ni emojis."
  2. "Formal y cortés" - "Trato de usted, con amabilidad."
  3. "Cercano" - "Trato de tú, claro y profesional."
  4. "Amigable" - "Trato de tú, cálido y con exclamaciones."
  5. "Muy casual" - "Trato de tú, expresiones de México y un emoji."
  English: Very formal / Formal and courteous / Friendly-neutral / Friendly / Very casual. Header chip becomes the chosen name ("Cercano") instead of "Nivel 3 de 5". If the slider is kept, add `aria-valuetext={name}` and `aria-describedby` for the effect line. Note that the choice never changes safety text ("La seguridad siempre se trata con el mismo cuidado.") as a hint under the group.

**P1-16. Business hours: technical timezone names, one range for all days, missing Mexican zones**
- `ToneForm.tsx:14` `TIMEZONES` shows raw IANA ids ("America/Mexico_City", "UTC", "Europe/Madrid"); `:133-150` one open/close pair for a day range; labels "De"/"a"/"Abre"/"Cierra" (`context/dict.ts:81-84`) read as a broken sentence.
- Mexico has more zones: Tijuana, Chihuahua, Mazatlán, Hermosillo (no DST), Cancún, CDMX/Monterrey. Chihuahua/Mazatlán/Hermosillo are missing.
- Fix: label options "Centro de México (CDMX, Monterrey, Guadalajara)" = America/Mexico_City, "Pacífico (Baja California)" = America/Tijuana, "Montaña (Chihuahua)" = America/Chihuahua, "Montaña (Mazatlán)" = America/Mazatlan, "Sonora (sin horario de verano)" = America/Hermosillo, "Sureste (Cancún)" = America/Cancun, plus "Otro país ..." disclosure. Default from the browser (`Intl.DateTimeFormat().resolvedOptions().timeZone`) only when unset. Labels: "Atendemos de [Lunes] a [Viernes], de [09:00] a [18:00]". Add an optional "Sábado distinto" row (second range) since many MX retailers close early Saturday; `serializeBusinessHours` already writes per-day keys.

### Admin screens: copy and flow

**P1-17. Add-ons: untranslated title, jargon in the manual flow, demo mode risk**
- `addons/dict.ts:5` es `title: "Add-ons"` (sidebar says "Complementos", `shell-dict.ts:5`); fix to "Complementos".
- `:25-28` manual steps: "Desarrollar apps", "Configuración de API Admin", "permiso read_orders", "datos protegidos de clientes", `form.token` "Token de acceso de la API Admin". The Spanish Shopify admin says "Aplicaciones y canales de venta > Desarrollar aplicaciones" (verify against current UI), so the path is probably wrong in Spanish too.
- Replace with plain steps and a help link, e.g. `manual.title`: "Cómo conectar tu tienda (pídele ayuda a quien administra Shopify)", s1 "En Shopify entra a Configuración > Aplicaciones y canales de venta > Desarrollar aplicaciones.", s2 "Crea una aplicación y marca solo el permiso 'Ver pedidos' (read_orders).", s3 "Instálala y copia la 'clave de acceso' que empieza con shpat_. Shopify solo la muestra una vez.", s4 "Activa también el acceso a datos de clientes, para que el asistente pueda comprobar el correo del pedido." Label `form.token`: "Clave de acceso (empieza con shpat_)". Keep `OAuth` path ("Continuar con Shopify") as the primary whenever configured.
- Demo store (`AddonsClient.tsx:104-106`): in a tenant with real channels connected, "Usar tienda de demostración" makes the bot answer #1001-#1004 with fake data to real customers. Show it only when no channel is connected, and when active render an amber banner in the Connected card (`status.demo` Badge is only blue "info", `:71`): "Estás en modo demostración: el asistente NO consulta pedidos reales. Conecta tu tienda para activarlo." Add the same warning on the dashboard step.
- Submit button never shows progress (`:100`): while `busy` use "Verificando..." / "Conectando...".
- `:111-120` the disabled Twilio card with a disabled "Próximamente" button and `opacity-70` is noise; collapse to one line "Próximamente: llamadas y SMS con Twilio".

**P1-18. Channels page leaks developer instructions**
- `channels/dict.ts:28` "Falta META_VERIFY_TOKEN en el archivo .env", `:33` "ngrok o cloudflared ... PUBLIC_URL", `:30-32` webhook steps, `:25-26` "Conexión con Meta (webhook)".
- Brand staff cannot act on any of this. Fix: move the whole card under a collapsed `<details>` titled "Para tu equipo técnico: configuración del webhook" (es) / "For your technical team: webhook setup" and rewrite the first line for staff: "Esto lo configura una sola vez tu equipo técnico. Copia y envíales estos dos datos:" plus a "Copiar instrucciones completas" button. Replace the missing-token text with `webhook.noToken`: "El servidor aún no está configurado para recibir mensajes de Meta. Avisa a tu equipo técnico." and the tunnel paragraph with: "Mientras tanto puedes probar tu asistente en Mensajes > Probar mi asistente; funciona sin conectar nada." Hide the section entirely in production when the token is set and all three channels are connected.
- Status wording: `error: "Con problemas"` is vague; use "Revisar conexión" with a button "Volver a conectar".

**P1-19. Sources: two-step upload and technical copy**
- `SourcesManager.tsx:112-117`: choose file, then press "Subir archivo" (2 controls). Make it one: a single button "Subir archivo" that opens the picker (`<label>`/ref.click()) and uploads on `onChange`; show filename + spinner while uploading.
- `context/dict.ts:127` `src.synced` "Sincronizada: {n} fragmentos." -> "Listo, el asistente ya aprendió de esta fuente." (en "Done, the assistant has learned from this source."). `:121` "Sincronizar" -> "Actualizar" (explain in a tooltip/hint: "Vuelve a leer el enlace por si cambió."). `:119` "Última sincronización" -> "Actualizada: {d}". `:132` `err.private_host` -> "Esa dirección no se puede leer desde internet. Usa el enlace público de la página." `:145` "El sitio respondió con un error ({code})" -> "La página no abrió (código {code}). Revisa que el enlace funcione y que no pida contraseña." `:134` "(máximo 2 MB)" -> "es muy pesada; prueba con una página más corta o sube el archivo". `:128` browser `type="url"` validation message is in browser language; keep the app message but add `noValidate` to the form.
- `:143` the "Eliminar" button is `ghost` with no danger color and identical label for every row (screen readers): add `aria-label={`${t("src.delete")}: ${s.title}`}` and `className="text-danger"`.
- Pending state: when `status === "pending"` show "Leyendo..." with a spinner instead of the neutral amber "Pendiente".

**P1-20. Context screen: placeholders are the only examples, and they vanish**
- `ContextForm.tsx:54`, `context/dict.ts:23-44` example text is in the `placeholder`; once the user types the example disappears and a first-time user may not know the format. `ctx.example` is defined (`dict.ts:18`) but never used.
- Fix: add a ghost button per empty section "Usar ejemplo" (`ctx.useExample`) that fills the textarea with the placeholder text (1 click). Add `ctx.chars` counter only near the limit. Also add a leave-page guard: `useEffect` -> `beforeunload` when `dirty`.
- Also `ContextForm.tsx:69`: Save is disabled when not dirty, which is correct, but add `aria-describedby` linking to the status text.

### Mobile and accessibility

**P1-21. Navigation on mobile**
- `Sidebar.tsx:44-60`: on phones the 7 nav items are a horizontally scrolling row with no scroll cue, and "English"/"Salir" sit below it (above the page content), pushing the main task down ~160px; 2 of the 7 items are emoji-labelled (`aria-hidden` icons are OK) but the sidebar has no `<nav aria-label>`, no `aria-current="page"`, and the waiting badge has no accessible text.
- Fix: below `md` render a bottom tab bar with 5 items (Inicio, Mensajes with badge, Asistente [Contexto/Tono/Fuentes as a sub-menu or three tabs on one page], Conexiones [Canales + Complementos], Más [idioma, salir]); on desktop keep the sidebar. Minimum quick fix: `<nav aria-label="Principal">`, `aria-current={active ? "page" : undefined}`, badge `aria-label={`${waiting} esperando`}`, move language/logout into the end of the nav row, add `scroll-px-3` and a right fade mask on the overflow row.

**P1-22. Inbox filters crowd phones**
- `InboxClient.tsx:83-97`: search + "Todas" + 4 platform chips + "Todas" + 4 status chips = 11 pills (3-4 wrapped rows) before the first conversation on a 375px screen.
- Fix: on `< md` show the status chips as a single horizontally scrolling row ("Necesitan a una persona (3)" first, red) and move platform into a `<select>` labelled "Canal". Keep search. Default status = "Necesitan a una persona" when its count > 0.

---

## P2 (nice to have)

**P2-1. Copy consistency (Spanish) and English parity**
- Same concept, different words: nav "Fuentes de datos" (`shell-dict.ts:4`) vs page title "Fuentes de información" (`dict.ts:99`); nav "Tono" vs page "Personalidad del asistente" (`dict.ts:47`); nav "Complementos" vs page "Add-ons" (see P1-17); nav "Mensajes" but the English page title is "Inbox" (`inbox/dict.ts:41`) while the English nav says "Messages" (`shell-dict.ts:15`) and English Channels text says "shows up in Inbox" (`channels/dict.ts:64`). Pick one: "Mensajes"/"Messages", "Fuentes"/"Sources", "Personalidad"/"Personality", "Complementos"/"Add-ons".
- `tone.sample` and several English strings use "chunks" ("Synced: {n} chunks.", `dict.ts:269`) -> "Synced. The assistant has learned from this source."
- Tuteo is used consistently in the admin UI; no stray "usted". Keep. Bot formal levels (1-2) correctly use usted.
- `dash.step.*` mix imperatives and infinitives; keep the current friendly imperative set.
- `"nav.lang": "English"` is good (language shown in its own language).

**P2-2. Login screen**
- `login/page.tsx:20-23`: add `autoComplete="username"`/`"current-password"`, `role="alert"` on the error, a show-password toggle (mobile typing), and a visible "¿Olvidaste tu contraseña? Escríbenos a ..." line. `metadata.title` is English "Social Inbox" (`app/layout.tsx:5`): set a Spanish template `%s · {tenant}` and per-page titles (screen reader users and browser tabs).

**P2-3. Destructive actions**
- All three use `window.confirm` (`SourcesManager.tsx:76`, `AddonsClient.tsx:143`, `ChannelsClient.tsx:71`): acceptable and accessible, but native confirm texts cannot name the item. Use an in-page dialog (`<dialog>`) with the item name: "Eliminar «Preguntas frecuentes»? El asistente dejará de usar esta información." with buttons "Cancelar" / "Sí, eliminar" (danger). Style the trigger buttons `text-danger`. `inbox` "Marcar como resuelta" and "Devolver al asistente" have no confirm (fine; add undo, see P1-13).

**P2-4. Save feedback**
- `ToneForm.tsx:162-166` has no "unsaved changes" state (Context has it). Mirror `ContextForm`: disable Save when not dirty, show "Tienes cambios sin guardar".
- `ContextForm.tsx:61`/`ToneForm.tsx:160`: the fixed save bar uses `md:left-60` to clear the sidebar; on small phones it covers the last field if content is short; `pb-24` handles it, but add `env(safe-area-inset-bottom)` padding for iOS home bar: `pb-[max(0.75rem,env(safe-area-inset-bottom))]`.

**P2-5. Placeholder/disabled contrast**
- `ui/index.tsx:117` `placeholder:text-muted/70` is about 3:1 on white; use `placeholder:text-muted`. Disabled buttons `opacity-50` are exempt but the Twilio card `opacity-70` dims readable text (`AddonsClient.tsx:111`): remove.

**P2-6. State what is not covered**
- Channels descriptions (`channels/dict.ts:11-13`) say "Mensajes directos" for IG but never say comments are not answered. Add: "Los comentarios públicos no se contestan todavía." (IG/FB) so owners are not surprised.

**P2-7. "No" at the start of a sentence is read as declining a pending offer**
- `text.ts` (file line ~30): `isNegative` -> `^(no|nel|nop|...)\b` plus the engine's `split(/\s+/).length <= 3` (`index.ts:112`). "No me llegó" (3 words) after "¿Quieres que te comunique con una persona?" gets `offerDeclined` ("Va. ¿Hay algo más...?"). Require the message to be exactly the negative token(s) or "no, gracias"; otherwise fall through to normal processing.

**P2-8. First-answer hello bug with empty agent name**
- `templates.ts:41` `.replace(/ ,| \./g, ".")` produces "Hola, soy." when the name is empty. Guard: if `!agentName` use "Hola." forms or "tu asistente". (Name is required in the Tone form, so only legacy rows hit this.)

**P2-9. Quick replies / buttons for customers**
- Channels support WhatsApp reply buttons and IG/Messenger quick replies. Offer the same three entry points the greeting lists (Estado de mi pedido / Garantía y envíos / Hablar con una persona) and "Sí / No" on `capOffer` and `noConnector` offers (`templates.ts:155-161,118-128`). This removes typing errors and speeds the order flow. Ask the integration architect for cost/approval notes (WhatsApp interactive messages are allowed inside the 24 h window).

**P2-10. Order-flow dialog polish**
- `orderNotFound` (`templates.ts:106-116`) should tell the customer how many tries remain only at the last one: after 2 failures add "Tienes un intento más." (tone-aware); third failure goes to `attempts` ("Por seguridad ya no puedo...") which can sound accusatory; soften es-tú: "Para cuidar tu información no puedo hacer más consultas de pedido en esta conversación. Te paso con una persona de nuestro equipo."
- English customers get the Spanish `statusText` from Shopify (noted in `docs/REQUESTS.md`); translate the 6-8 standard statuses in `shopify/mapping.ts` per language.
- `orderFound` prints the raw URL after "Rastreo:"; fine for WhatsApp/IG, keep the link on its own line (it already is).
- After a successful lookup add a closing line at tone >= 3: "¿Te ayudo con algo más?" (the flow currently ends abruptly; cross-sell sometimes follows).

**P2-11. Handoff promise wording**
- `templates.ts:246` "Una persona te contactará por este medio en breve" when `open === true`. If three people are waiting this over-promises. Use "lo antes posible" in all cases, and only mention hours when closed.

**P2-12. Thread header and waiting time in Inbox**
- `InboxClient.tsx:177-187`: add "Esperando desde hace 12 min" in red for `needs_human` (use `lastMessageAt`), keep the reason label but translate more naturally ("Motivo: seguridad" -> "Reportó un problema de seguridad", "Motivo: tema legal" -> "Mencionó un tema legal").
- List row: `aria-label="unread"` (`:117`) is English in the Spanish UI -> `t("unread")` ("No leída").
- `Chip` buttons should expose `aria-pressed={active}` (`:145`) and the list `<ul>` a live count (`aria-live="polite"` on a visually hidden "3 conversaciones esperan a una persona").

**P2-13. Live regions in chat**
- `InboxClient.tsx:195` thread container: add `role="log" aria-live="polite" aria-label={t("thread")}` so new customer messages are announced; avoid re-announcing the whole history by only appending (already keyed by `m.id`). Keep the window banner `role="alert"` (fine) but it re-announces on every poll if re-rendered: render once per conversation id.
- `AddonsClient.tsx:176` result box is `role="status"`: good. `ChannelsClient.tsx:83` message `role="status"`: good.

**P2-14. Keyboard**
- Inbox reply textarea supports Ctrl/Cmd+Enter (`InboxClient.tsx:213`) but nothing tells the user: add hint "Ctrl+Enter para enviar" on desktop. Ensure the tone preview-language buttons and rating cards have a visible focus ring (`focus-visible:ring-2` is on `btn` only; `Chip`, nav links, tone buttons, `PlatformIcon` rows lack it). Add a global `:focus-visible { outline: 2px solid var(--brand); outline-offset: 2px; }` in `globals.css`.
- Add a "Saltar al contenido" skip link in `(app)/layout.tsx` before the sidebar.

**P2-15. Information architecture**
- 7 nav items for a "few steps" product. Group into Inicio, Mensajes, Mi asistente (Contexto + Tono + Fuentes as tabs of one page, same "Guardar"), Conexiones (Canales + Complementos). Reduces the "where do I go" cost and the mobile bar to 4-5 items. Redirect old routes.

**P2-16. Empty states with a next action**
- `InboxClient.tsx:99` "No hay conversaciones todavía." -> add a button "Probar mi asistente" and, if no channel is connected, "Conectar un canal". Sources empty state (`SourcesManager.tsx:124`) -> "Aún no hay fuentes. Agrega un enlace o sube un archivo con tus preguntas frecuentes." Filtered-empty vs truly-empty should differ ("No hay conversaciones con este filtro. Ver todas").

**P2-17. Timezone/locale formatting**
- `SourcesManager.tsx:32` and `AddonsClient.tsx:146` format dates with es-MX: good. `escalate.ts:359-377` `formatBusinessHours` prints "lun–vie 9:00–18:00" (24 h style without "h"): for customers add " h" and use "de lunes a viernes de 9:00 a 18:00 h" in Spanish: more natural, and `text` override still wins.

**P2-18. Misc**
- `PlatformIcon` shows two-letter codes (WA/IG/MS/SIM) in colored circles (`inbox/ui.tsx:6-10`): add the platform name as visually hidden text (currently `aria-hidden`; the name is not elsewhere in the row) so screen-reader users know the channel.
- `dash.subtitle` "Cada paso es un solo botón." is a nice promise; keep it only after P1-11 makes it true.
- `ChannelsClient.tsx:46` shows the verify token in a plain input for any logged-in user; fine for now (single-tenant), but mask it by default with a "Mostrar" toggle when more users/roles are added.

---

## Top 5 fixes (do these first)
1. **P0-2** Stop persisting default greeting/fallback in `saveToneAction`, so the tone slider (and the agent name, and usted vs tú) actually drives greeting and handoffs; then expand `templates.ts` to 5 real voices (**P1-3**) and make the preview use the real templates (**P1-4**).
2. **P0-1** Handle attachments/voice/stickers: store them and hand off with a friendly "recibimos tu archivo" message instead of silence.
3. **P0-3** Make Channels a guided, verified connection (plain-language help per field, test call, "Conectar y probar", technical webhook details collapsed for the tech team; later Facebook Login for Business).
4. **P0-4** Add `--on-brand`/`--on-danger`/`--ok`/`--warn` tokens so primary buttons and status text are readable in dark mode.
5. **P1-11 + P1-9 + P1-13** Dashboard with one primary "next step" and the right order (test before channels), simulator that does not pollute counts or trigger real alerts (with starter chips), and inbox with one-step "Responder", friendly send errors, loading state and live waiting alerts.
