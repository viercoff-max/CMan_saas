# 06 - Compliance, Privacy and Security (Data & Compliance Lead)

I am not a lawyer. Items marked **[COUNSEL]** need a Mexican privacy attorney before go-live.

## 1. Mexican law (LFPDPPP)
- A new LFPDPPP was published 20-Mar-2025 and entered into force 21-Mar-2025, replacing the 2010 law. INAI was dissolved and the authority is now the Secretaria Anticorrupcion y Buen Gobierno. The new law adds a simplified aviso de privacidad modality and requires consent that is "free, specific and informed" ([GT summary](https://www.gtlaw.com/-/media/files/insights/alerts/2025/3/alerta-gt_nueva-ley-federal-de-proteccion-de-datos-personales-en-posesion-de-los-particulares.pdf?rev=d38b3e556aac464cb7a5068e937122ad), [Baker Tilly](https://www.bakertilly.mx/en/insights/nuevas-disposiciones-en-materia-de-datos-personales)). The implementing regulations are probably still pending. **[COUNSEL]** confirm which rules currently apply.
- Roles: the brand (Chefman) is **responsable** (controller); we are **encargado** (processor). The platform needs a contract (DPA / clausulas de encargo) with each brand: process only on documented instructions, confidentiality, subprocessor list (Vercel, Supabase, OpenAI, Meta), deletion/return at exit, breach notice, and brand audit rights. The DPA is a template we reuse for brand #2 and #3.
- The brand's aviso de privacidad must cover the chatbot: data collected (IG/FB ID, name, message content, order number, email, order status), purposes, AI/automated processing, transfers to processors, ARCO rights channel, and retention. The brand must make it available before or at first contact. In a DM the practical approach is a first-message notice in the bot ("Al continuar aceptas el aviso: link") and a link in the IG/FB profile. The platform provides a template and a per-brand `privacy_url` field. **[COUNSEL]** confirm whether the simplified aviso suffices and whether cross-border transfer (OpenAI/US) needs specific wording or consent.
- Handle ARCO requests (access, rectification, cancellation, opposition) with an admin "delete this customer's conversations" function.
- Order data is not "sensitive" under the law. Do not collect anything sensitive.

## 2. Meta platform policies
- **24h window**: replies are allowed only within 24h of the customer's last message. Proactive outreach is out of scope, which suits us. Do not build re-engagement. Check whether the human-agent tag (7 days) is useful for email-to-human follow-ups; I have not verified it, so treat it as a later item.
- **Privacy policy URL** is mandatory for the app (we own a platform policy; each brand also has its own).
- **Data deletion callback or instructions URL** is mandatory. Implement a callback endpoint that deletes by PSID/IGSID and returns a confirmation code and status URL.
- **App review**: `pages_messaging`, `instagram_manage_messages` and related permissions need Advanced Access plus **Business Verification**, a screencast and test credentials. Lead time varies and can be several weeks, so it is the biggest schedule risk for the 2-week MVP. Until approved, only app role users (testers) can talk to the bot in Standard Access. Start the submission on day 1 and be ready to launch Chefman in a limited state if approval lags. **[VERIFY]** current requirements in the Meta developer docs, since they change often.
- Multi-tenant model: ONE Meta app (ours), each brand connects its Page/IG via Facebook Login OAuth. Business Verification is needed for apps serving other businesses (Tech Provider status). This also answers the owner's open question: self-serve OAuth is possible once the app is approved; before that, developers must add the brand as tester or have the brand grant access manually.
- Identify the bot as automated and provide an obvious human-handoff path.

## 3. Order verification abuse (order number + email)
- This is weak authentication: order numbers are guessable and emails are easy to learn. Mitigations:
  - Return **only order status** (already the scope); never address or items. Show a generic failure ("no encontramos un pedido con esos datos") that does not reveal whether the order or the email was wrong.
  - Rate limit per IG/FB sender (e.g. 5 attempts / 30 min), per IP, and per order number; then lock the sender for 1h and escalate (progressive lockouts). Use Upstash/Supabase counters, and make comparisons constant-time and case-insensitive on email.
  - Alert on enumeration patterns (many different order numbers from one sender or many senders on one order).
  - Do not let the LLM see unverified order data. Verification is deterministic code, never a prompt. Verified status lasts only for the session (e.g. 30 min).
  - Do not echo the email back in full; mask it.

## 4. PII to OpenAI
- API data is not used for training by default and abuse-monitoring logs are retained up to 30 days; Zero Data Retention is available only by request for eligible accounts ([OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data)). Set `store: false` where applicable.
- Minimize: the model should never receive the email, full name or address. The code does verification and the lookup, then passes only a templated fact such as "status: shipped, carrier X, ETA Y" (order number optional/masked). Redact emails, phone numbers and card-like strings from user text before the call. The model gets the knowledge base plus tone settings, not customer records.
- Add OpenAI to the subprocessor list and sign OpenAI's DPA. **[COUNSEL]** transfer wording.
- Prompt-injection guardrails: the model has no tools that write, and no order data beyond what the code injects.

## 5. Multi-tenant isolation, secrets, audit
- Supabase: `brand_id` on every table with RLS enabled by default (deny-all, then policies via the JWT `brand_id` claim). The service role is used only server-side in webhooks and workers, with an explicit `brand_id` filter in every query. Add automated tests that a user of brand A cannot read brand B.
- Encrypt Meta page tokens, Shopify tokens and any per-brand keys: Supabase Vault or application-level AES-256-GCM with the key in Vercel env vars. Never log tokens, never expose them to the client, and plan rotation and re-auth on expiry. Verify the webhook `X-Hub-Signature-256` on every request.
- Retention: keep conversations for at least 30 days (owner requirement); the default is a configurable per-brand value (e.g. 90 days), then a scheduled purge job, with deletion on ARCO or Meta callback. Logs of verification attempts are kept shorter. **[COUNSEL]** confirm the period against the aviso.
- Admin access: roles (owner/admin/viewer) per brand, MFA via Supabase, and an append-only `audit_log` (who viewed which conversation, exports, deletes, config changes). Platform staff access to brand data is "break-glass" and logged.

## 6. Option A vs Option B
| | A: custom code (Vercel+Supabase+OpenAI) | B: n8n or helpdesk |
|---|---|---|
| Tenant isolation | Strong, RLS under our control | n8n is weak at per-tenant isolation: shared credentials/executions store PII in logs; hard to enforce. Helpdesk (Gorgias/Respond.io) is separate per customer but not our product |
| PII to OpenAI | Full control of redaction | Possible but easy to bypass in node wiring |
| Rate limit/lockouts | Straightforward | Awkward |
| Audit/retention | Built to spec | n8n execution logs hold PII by default; must be pruned |
| Speed | Slower | Faster for a single brand |
| Fit with business model | Yes (resellable) | No: helpdesk license cost per brand and loss of the product; n8n self-hosted adds another processor/host |

## 7. Recommendation: Option A
A custom build is the only option that is clean for multi-tenant resale, and compliance controls are easier to implement in code. n8n may be used for non-PII internal automation only.

**MVP must-haves (2 weeks):** Meta app submission started day 1 plus privacy URL and data-deletion callback; webhook signature verification; single-tenant-ready schema with `brand_id` and RLS from the start; deterministic order-number+email verification with rate limiting, lockouts and generic errors; status-only responses; PII redaction/minimization before OpenAI; encrypted tokens; 30+ day retention with a purge job; admin login with roles; basic audit log; privacy/terms pages and bot first-message notice; DPA template and counsel review of the aviso; escalation triggers (safety/legal/human request).

**Later:** self-serve Meta OAuth for brands, Business Verification/Tech Provider polish, ARCO self-service tooling, MFA enforcement, anomaly alerts, ZDR with OpenAI, per-brand retention UI, SOC2-style controls, PII scanning in logs, GDPR/CCPA readiness for non-Mexican brands.
