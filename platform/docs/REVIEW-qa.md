# QA review: cross-module integration (headless)

Owner: QA. Tests live in `src/e2e/` (run with `npm test`; e2e only: `npx vitest run src/e2e`).

## How the e2e suite runs
- `src/e2e/setup.ts` (imported first by every e2e file): temp `DATA_DIR`, test `APP_SECRET`, `META_APP_SECRET`, `META_VERIFY_TOKEN`, `PUBLIC_URL`, no `OPENAI_API_KEY`, and `process.cwd()` pointed at a temp folder. That last part is a workaround for BUG-1, so the outbox never lands in the real `data/`.
- Only the network is faked:
  - OpenAI: through the engine's injectable `EngineDeps.llm`. The webhook path can't inject an LLM, so there the fetch stub answers `api.openai.com`, which also exercises `openAiLLM`.
  - Meta Graph: a `fetch` stub (`vi.stubGlobal`).
- Framework shims (not app logic). Next's request-scope APIs throw outside a real request, so `src/e2e/mocks.ts` replaces:
  - `cookies()` (`next/headers`): the real `auth.ts` then validates a real signed session cookie;
  - `after()` (`next/server`): the callback is queued and flushed, the same way Next runs it after the response;
  - `revalidatePath` (`next/cache`): no-op.
- Everything else is real: `store.ts`, the context module (`reindexSection`, `saveContextAction`, `saveToneAction`, `serializeBusinessHours`), the Channels actions, the engine, the connectors registry, `shopifyConnector` with the demo store, `notifyHandoff` (writes the outbox file), `sendToCustomer`, and the inbox route handlers (`status`, `reply`, `simulate`, `webhooks/meta` GET/POST).

## Results (last run, 2026-10-05)
- **e2e: 62 tests. 60 pass, and 2 are `it.fails` that document open bugs (BUG-2, BUG-3).** An `it.fails` test turns red once its bug is fixed; then switch it to `it`.
- Other agents fixed BUG-1, BUG-2b, BUG-4, FINDING-D and FINDING-F while this review was running. The tests for those are now regression tests that pass. BUG-4 has a new finding, H.
- `npx tsc --noEmit`: no errors in `src/e2e/`.
- Full `npm test` at the end: 315 pass, 5 fail, all in other agents' files that were still being edited (`channels/__tests__/meta.test.ts` still uses the old `nodeEnv` policy; `webhooks/meta/data-deletion` imports a missing `@/lib/retention/meta-deletion`; `fetch-safe.test`; one `engine.test` "too old"). The tsc errors are in the same in-progress files (for example, `media` is not yet on `InboundEvent`). Re-run once they settle.
- Changed while testing (tests already adapted):
  - inbox routes now require a same-origin Origin (CSRF): covered by a cross-site test that gets 403;
  - `connectChannel` tests the token on Graph `GET /{id}` (stubbed);
  - the simulator channel no longer writes outbox mails, so outbox assertions use the whatsapp channel;
  - templates were reworded per tone.

### What passes (integration verified)
1. **Context to answers** (`knowledge.e2e.test.ts`)
   - `saveContextSection` + `reindexSection` create chunks that the engine retrieves.
   - The LLM receives only the tenant's matching sources. `dos_donts`/`escalation` go into the system prompt and are never used as sources.
   - The reply is grounded in a source (and `meta.sources` is recorded).
   - The product question uses the products section.
   - An invented promo is blocked by the validator and handed off.
   - Unknown question: the first time the bot asks for clarification; the second time it escalates `needs_human/no_answer`, the LLM is never called, and the real `notifyHandoff` writes an outbox file with reason, customer, link `PUBLIC_URL/inbox?c=<id>` and recent messages. The bot then stays silent.
   - The offline fallback (`defaultLLM` with no key) answers from context.
2. **Shopify demo + order flow** (`orders.e2e.test.ts`)
   - Demo connect (same `saveAddon` as `/api/shopify/demo`) makes the registry return `shopifyConnector`.
   - The `#1001` + `test@example.com` multi-turn flow returns status only: Enviado, Estafeta, tracking, ETA. No address/items/phone/payment words, and the email is not in the reply, `conversation.state`, bot bodies or bot meta.
   - A wrong email and an unknown order get the same generic text.
   - 3 failures: `attempts` lockout with `needs_human` and an outbox notification, `state.order.locked`, then silence. No 4th lookup happens.
   - After disconnecting the add-on, the bot says it cannot check orders.
3. **Escalations/language** (`knowledge.e2e.test.ts`)
   - "mi licuadora sacó humo" escalates immediately as `safety`: no LLM call, no emoji, `[URGENTE]` subject on the outbox mail.
   - Safety takes priority even inside a question.
   - PROFECO/abogado escalate as `legal` (also `[URGENTE]`).
   - "quiero hablar con una persona" escalates as `human_request`.
   - English input switches to English for the knowledge answer, the human handoff and the safety template (`state.lang = en`, LLM `lang = en`).
4. **Human takeover** (`takeover.e2e.test.ts`)
   - Status route `take` sets `human`. The bot stays silent (inbound stored, no LLM call, no bot message).
   - The reply route sends to Graph `/{phone_number_id}/messages` with the decrypted token and `to = wa_id`, then stores an `agent` message with `agentUserId`.
   - `return` resumes the bot.
   - A reply on a `needs_human` conversation sets `human`.
   - A Graph error returns 502 and the message is not stored.
   - Another tenant's session gets 404; no session gets 401.
5. **Meta webhook** (`webhook.e2e.test.ts`)
   - GET handshake: right token echoes the challenge, wrong token gets 403.
   - The Channels `connectChannel` action stores `publicInfo.externalId` as the webhook expects.
   - A signed WhatsApp POST returns 200, is routed by `phone_number_id` to the right tenant (two tenants), calls OpenAI with no customer name, and sends the reply to `wa_id` with that tenant's token.
   - An unknown account id is ignored.
   - Instagram (`object: instagram`) and Messenger (`object: page`) route by `entry.id` and reply through `/me/messages` with the right token. The Messenger human request escalates.
   - An IG echo is ignored.
   - A duplicate `wamid` (sequential AND concurrent) gives ONE inbound row, ONE bot reply and ONE Graph send.
   - A bad, wrong-secret or missing signature gets 403 and nothing is stored or sent.
   - Malformed JSON with a valid signature gets 400.
6. **Business hours** (`hours.e2e.test.ts`)
   - Output of `serializeBusinessHours` (Tone) is read correctly by the engine's `parseBusinessHours`/`isOpenNow` in America/Mexico_City:
     - Mon 08:59 closed, 09:00 open, 17:59 open, 18:00 closed;
     - Fri open, Sat/Sun closed;
     - the tenant time zone is used, not the server's (Tijuana DST checked);
     - wrap-around Sat..Tue and Sunday-only both work.
   - The Tone screen re-reads exactly what it saved.
   - The engine summary is `lun–vie 9:00–18:00` / `Mon–Fri 9:00–18:00`.
7. **Handoff wording** (`hours.e2e.test.ts`, via the real `saveToneAction`)
   - Sunday: "fuera de nuestro horario de atención (lun–vie 9:00–18:00) … en cuanto abramos", and `meta.outsideHours = true`.
   - Mon 18:30 is outside hours; Mon 10:00 says "en breve".
   - Tone 1 + safety keeps the safety text and uses "usted".
   - English: "outside our business hours (Mon–Fri 9:00–18:00)".
   - `no_answer` uses the Tone default fallback message plus the hours line.
8. **UI actions** (`actions.e2e.test.ts`)
   - `saveContextAction` (with the full record the UI sends) saves and reindexes, and saving unchanged content changes nothing.
   - Clearing a section removes its chunks.
   - The `/api/inbox/simulate` POST answers from the saved context; DELETE resets.

## Bugs

### BUG-1 (FIXED during review): Handoff outbox ignores `DATA_DIR`
- **Repro:** set `DATA_DIR=/tmp/x` and trigger any escalation.
- **Expected:** the file is written in `/tmp/x/outbox/`, next to `app.db`.
- **Actual:** the file is written in `<process.cwd()>/data/outbox/`. Tests, or a deployment with a separate data volume, write outside the data dir. On Vercel later, cwd is read-only.
- **Culprit:** `src/lib/channels/handoff.ts:44`.
- **Fix:** `path.join(process.env.DATA_DIR ?? path.join(process.cwd(), "data"), "outbox")`. Better still, export a `DATA_DIR` constant from `db.ts`, the same way `UPLOAD_DIR` is exported.
- **Test:** `knowledge.e2e.test.ts` "BUG-1".

### BUG-2 (OPEN for message bodies; FIXED for the outbox mail, which now masks emails, BUG-2b): Customer email stored in plain text in message bodies, and copied into the handoff mail
- **Repro:** the customer sends "pedido #1001 correo test@example.com" (or just the email when asked).
- **Expected:**
  - Product rule: never log customer emails.
  - The email is used for the lookup only. The engine already deletes it from `state`, and bot replies/meta are clean.
- **Actual:**
  - The inbound message row keeps `test@example.com` verbatim.
  - `notifyHandoff` copies the last 10 bodies into the outbox file, so an `attempts` lockout mail contains all 3 guessed emails.
- **Culprit:**
  - `src/lib/engine/index.ts:73`: `addMessage(... body: text ...)` stores the raw text.
  - `src/lib/channels/handoff.ts:39-42`: bodies are copied unredacted.
- **Fix:**
  - Store the inbound body with emails masked. `maskEmail` exists in `engine/orders.ts`, so this could be `text.replace(EMAIL_RE, maskEmail)`; or use `redactPII` before `addMessage`. Pass the raw `text` only to `runOrderFlow`.
  - In `handoff.ts`, map bodies through the same redaction.
  - Decide with the owner whether agents need the full email in the inbox. If they do, keep it masked in the mail and the logs at least.
- **Tests:** `orders.e2e.test.ts` "BUG-2" and "BUG-2b".

### BUG-3 (OPEN): Hours that close at or after midnight are lost
- **Repro:** on the Tone screen choose open 20:00, close 02:00 (or 09:00–00:00). Then trigger a handoff.
- **Expected:** the engine knows the business is open at 23:00 and shows the hours.
- **Actual:**
  - `parseRanges` requires `close > open`, so every day is dropped and `configured = false`.
  - The handoff says "lo antes posible" with no hours and never "fuera de horario".
  - The Tone form and action accept the values silently.
- **Culprit:**
  - `src/lib/engine/escalate.ts:67` and `:73` (`c > o`).
  - No `close > open` check in `src/app/(app)/tone/actions.ts:16-24` or `ToneForm.tsx:144-149`.
- **Fix (pick one):**
  - (a) Tone: add a zod `refine(h => h.close > h.open)` and show an error.
  - (b) Engine: treat `close <= open` as overnight. Push `[open, 24:00]` on day d and `[0, close]` on day d+1, and treat "00:00" close as 24:00.
- **Test:** `hours.e2e.test.ts` "BUG-3".

### BUG-4 (FIXED during review by unique index `uq_channel_external` in db.ts; see FINDING-H): Two tenants can connect the same Meta id, so webhook routing becomes ambiguous
- **Repro:** tenant A connects WhatsApp `phone_number_id = X`. Tenant B then connects the same `X`.
- **Expected:** the second connect is rejected (or needs verification). Messages for X always go to A.
- **Actual:** `connectChannel` returns `{ok:true}`. `findTenantByChannelExternalId` returns whichever row SQLite yields first, so a tenant could take over another brand's inbound messages (and they would be answered with B's context).
- **Culprit:**
  - `src/app/(app)/channels/actions.ts:31`: no uniqueness check.
  - `src/lib/store.ts:203-205`: first match wins.
- **Fix:**
  - Before saving, if `findTenantByChannelExternalId(channel, id)` returns another tenant, return `{ok:false, error:"in_use"}`.
  - In production, add a unique index on (channel, externalId), and verify ownership with the token (`GET /{id}?access_token=`).
- **Test:** `actions.e2e.test.ts` "BUG-4".

## Findings (documented by passing tests; product or security decisions, not crashes)

### FINDING-A: Order attempt limit can be bypassed by opening new conversations (asked by lead)
- **Severity:** medium.
- **Repro (test "FINDING-A"):**
  1. Number 1 makes 3 wrong guesses on #1001 and gets locked.
  2. A new WhatsApp number (new conversation) gets 3 fresh attempts on the same order.
  3. Its 2nd guess with the right email gets the status. That is 5 lookups on one order.
- **Why:** failures and the lock live only in `conversation.state.order` (`src/lib/engine/orders.ts:137-141`), and the conversation is keyed by (channel, externalId).
- **Impact:** brute-forcing emails for a known order number only needs new IG/FB accounts or WhatsApp numbers. Risk is limited because only the status is revealed (no PII), but it still confirms that an email/order pair matches.
- **Fix:** keep a per-tenant counter keyed by normalized order number, e.g. table `order_lookup_failures(tenant_id, order_number, count, window_start)` in `engine/repo.ts`. Lock the order (hand off) after N failures within 24 h across all conversations, and add a per-tenant global rate limit for lookups.

### FINDING-B: "Return to bot" keeps the stale `escalation_reason`
- **Severity:** low.
- **Why:** `setConversationStatus` uses `COALESCE(?, escalation_reason)` (`src/lib/store.ts:142`), so `status` route `return`/`resolve` cannot clear it. The UI may keep showing e.g. "safety" on a bot conversation.
- **Fix:** add `clearEscalationReason(tenantId, id)` in `src/lib/channels/repo.ts` and call it from `status/route.ts` on `return`.

### FINDING-C: After a `no_answer` handoff and "return to bot", the next unknown question escalates without a clarify turn
- **Severity:** low.
- **Why:** `state.misses` is not reset by `escalate()`; it is reset only when the status is `resolved` (`src/lib/engine/index.ts:83-86`, `:242-253`).
- **Fix:** set `state.misses = 0` in `escalate()`.

### FINDING-D (FIXED during review: `signaturePolicy` now fails closed; `ALLOW_UNSIGNED_WEBHOOKS=1` only works with a local `PUBLIC_URL`; e2e regression test added): Unsigned webhooks are accepted when `META_APP_SECRET` is missing and `NODE_ENV !== "production"`
- **Severity:** medium for on-prem.
- **Why:** the on-prem plan is `npm run dev` behind a tunnel, where `NODE_ENV = development`. If the secret is not configured, anyone who knows the URL and a `phone_number_id` can inject messages and trigger handoff mails or Graph sends.
- **Culprit:** `src/lib/channels/meta.ts:39-44`.
- **Fix:** require the secret whenever any Meta channel is connected, unless there is an explicit `ALLOW_UNSIGNED_WEBHOOKS=1` for local tests.

### FINDING-E: Fresh tenant shows hours the engine does not apply
- **Severity:** low.
- **Why:** `business_hours` defaults to `'{}'`. The Tone screen displays `DEFAULT_HOURS` (Mon–Fri 9–18), but the engine treats `{}` as "not configured" and says "lo antes posible" with no hours until the owner presses Save.
- **Fix:** either the engine falls back to the same default, or the Tone screen shows "sin configurar".

### FINDING-F (FIXED during review: the Tone action stores "" and the engine greets with the agent name): The Tone default greeting ignores the agent name
- **Severity:** low.
- **Why:** with an empty greeting, the saved default "¡Hola! Soy el asistente virtual…" overrides the engine's own tone-aware greeting that uses `agentName` (`src/lib/context/settings.ts:40-41`, `tone/actions.ts:34`).
- **Fix:** save `""` and let the engine template apply, or interpolate the name.

### FINDING-G: The validator only checks promos, URLs, action claims and leaks, not facts
- **Severity:** inherent; documented.
- **Why:** an LLM reply "La garantía es de 5 años" passes when the sources say "1 año". Only the prompt guards against this.
- **Possible mitigation:** for numeric claims (digits plus units such as años/días/%/$), require the number to appear in the sources; otherwise hand off.

### FINDING-H: Connecting an already-used channel id throws a raw SQLite error
- **Severity:** low.
- **Why:** `connectChannel` (`src/app/(app)/channels/actions.ts`, the `saveChannelAccount` call) does not catch the `UNIQUE constraint failed: uq_channel_external` error. The server action rejects, and the UI shows a generic error instead of "este número ya está conectado a otra cuenta".
- **Fix:** before testing on Graph, check `findTenantByChannelExternalId(channel, id)`, or catch the error, and return `{ ok:false, error:"in_use" }`.
- **Test:** `actions.e2e.test.ts` "BUG-4 (fixed…)".

### Note: `saveContextAction` rejects partial payloads
- **Why:** zod v4 `z.record(z.enum)` is exhaustive. This is harmless because `ContextForm` always posts all 8 keys, but any other caller (import, API) must send every key. `z.partialRecord` would be more forgiving.

### Note: the reply route does not enforce the 24 h window server-side
- **Where:** `reply/route.ts:16`. Only the messages route reports `windowExpired`.
- **Effect:** Meta rejects the send (131047) and the route returns 502 `send_failed`. Behavior is correct, but the UI error should explain the 24 h window.

## Not covered (needs a browser or real services)
- All React UI:
  - Context/Tone/Sources/Inbox/Add-ons/Channels screens, the 4 s polling, the ES/EN toggle, mobile layout;
  - one-primary-button rule;
  - the login form and cookie flags.
- Next runtime behavior: the real `after()` scheduling, the `proxy` (middleware) auth redirect, server-action transport, and `params` as Promises inside a running Next server.
- Real OpenAI quality: obedience to `[HANDOFF]`, refusal to invent, tone adherence, language mixing.
- Real Meta: app review, permissions, token expiry, IG with Instagram Login vs FB Login endpoints (`/me/messages` on graph.facebook.com assumes a page token), 24 h window and templates, media/sticker/reaction messages (ignored), `statuses` callbacks, rate limits.
- Real Shopify: OAuth connect/callback with HMAC, the GraphQL order query, `read_all_orders` and the `tooOld` heuristic, protected customer data approval (email missing leads to a generic failure), network failures.
- Sources: URL fetch (`fetch-safe`, SSRF guards) and PDF/DOCX extraction against real files; upload route size limits.
- SMTP/Resend delivery of handoff mails (only the outbox file exists locally).
- Concurrency across multiple Node processes (SQLite WAL with several workers) and webhook dedupe across instances. Dedupe is safe within one process only because the check and insert run synchronously before the first `await`.

## Fix status (final fixer, 2026-10-05)
- BUG-2 fixed (inbound bodies stored with emails masked); test is now a normal regression test.
- BUG-3 fixed: engine treats close <= open as overnight (spills into the next day; 00:00 close = 24:00); Tone accepts it, shows "closes after midnight", rejects open == close.
- FINDING-B/C fixed: status route `return`/`resolve` clears `escalation_reason` and resets misses/offer/bot-turn cap (`channels/repo.ts#resetConversationForBot`); `escalate()` resets misses.
- FINDING-E fixed: Tone shows the default hours as "Sin horario definido ... aún no está guardado" until saved (`hoursAreSaved`).
- FINDING-G fixed: validator rejects numeric facts (number + duration unit, or price) not present in the retrieved sources (`unsupported_fact`).
- FINDING-H fixed: `connectChannel` returns `{ok:false, error:"in_use"}` ("Esa cuenta ya está conectada a otra marca") via a pre-check and by catching the unique-index error.
- `npm test`: 407 passed, 0 failed, no `it.fails` left.
