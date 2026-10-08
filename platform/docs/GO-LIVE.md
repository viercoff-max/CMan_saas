# Go-live: connecting real WhatsApp, Instagram, Messenger and Shopify

This is a checklist for the owner. Do the steps in order. Each step says **where** to click and **what to paste
where**. If something is marked **(not verified)**, we could not confirm it in Meta's or Shopify's official docs on
2026-10-06. Check that screen yourself.

Before you start, finish `docs/RUNBOOK.md` sections 1 and 2: the app runs from a folder outside OneDrive, in production mode.

---

## 0. What the app expects (for the technical person)

| Setting (`.env.local`) | Value | Needed for |
| --- | --- | --- |
| `PUBLIC_URL` | `https://inbox.yourdomain.com` (your tunnel address, step 1) | all |
| `META_VERIFY_TOKEN` | any long random text you make up (`node -e "console.log(require('crypto').randomBytes(24).toString('base64url'))"`) | Meta webhook |
| `META_APP_SECRET` | Meta app > App settings > Basic > **App secret** | Meta webhook signature (unsigned or badly signed calls are rejected) |
| `META_IG_APP_SECRET` | optional: only if you use "Instagram API with Instagram Login" and its webhooks are signed with the **Instagram app secret** (not verified which secret Meta uses there; setting both is safe) | Instagram Login |
| `META_HUMAN_AGENT` | `1` only **after** Meta approves the *Human Agent* permission | lets a person answer Messenger/Instagram up to 7 days |
| `SHOPIFY_API_KEY`, `SHOPIFY_API_SECRET` | only for the one-click OAuth button. **Not needed** with the recommended Dev Dashboard method (step 6) | Shopify OAuth |

Restart the app after you change `.env.local`.

Versions pinned in code (change in ONE place each):
- Meta Graph API `v25.0`: `src/lib/channels/graph.ts`. Supported until July 2028. v26.0 also exists.
- Shopify Admin API `2026-10`: `src/lib/shopify/config.ts`. Supported until 2027-10-16. Move to the newest version once a quarter.

---

## 1. Put the app on the Internet: only two paths

Meta must reach `https://<your address>/api/webhooks/meta` (messages) and `/api/webhooks/meta/data-deletion`.
**Nothing else** must be public: no login page, no inbox.

**Production (recommended): Cloudflare named tunnel.** Use the `config.yml` from `docs/RUNBOOK.md` section 3. If you
connect Shopify with the Dev Dashboard method (step 6), you can **remove** the `/api/shopify/callback` rule: it is only for
the OAuth button.

```
cloudflared tunnel login
cloudflared tunnel create socialinbox
cloudflared tunnel route dns socialinbox inbox.yourdomain.com
cloudflared tunnel --config C:\ProgramData\SocialInbox\cloudflared\config.yml run socialinbox
```

Check:
- `https://inbox.yourdomain.com/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=WRONG&hub.challenge=1` answers **403**.
- `https://inbox.yourdomain.com/login` answers **404**. If it opens the login page, the tunnel rules are wrong. Stop and fix them.

**Quick test only (not for real customers):** `cloudflared tunnel --url http://127.0.0.1:3000` gives a temporary
`*.trycloudflare.com` address, but it exposes the WHOLE app. Use it for an hour with test accounts, then close it.
ngrok can also limit paths with a "traffic policy", but we did not verify that syntax. Prefer cloudflared.

Meta needs a valid HTTPS certificate. Self-signed certificates are rejected. Cloudflare gives you a valid one.

---

## 2. Meta: business, app and common settings (once)

1. **Business portfolio.** At business.facebook.com, use (or create) Chefman's business portfolio. Add the Facebook
   Page, the Instagram account and the WhatsApp number there.
2. **Business Verification.** Business settings > Security center > Start verification. You need the legal name, address,
   tax ID and a document. Advanced access, Human Agent and a real WhatsApp number at scale all depend on it. It can take days.
3. **Create the app** at developers.facebook.com > My apps > Create app. Pick the business portfolio from step 1.
   Choose the use case that includes messaging: "Engage with customers on Messenger from Meta", plus WhatsApp and Instagram.
   In the older flow, choose app type **Business**. (Not verified: Meta renames these use cases often.)
4. **App settings > Basic**:
   - **Privacy Policy URL**: Chefman's privacy notice (aviso de privacidad).
   - **User data deletion**: choose "Data deletion callback URL" and paste `https://inbox.yourdomain.com/api/webhooks/meta/data-deletion`.
   - Category, icon, contact email.
   - Copy the **App secret** into `META_APP_SECRET`.
5. **App mode = Live** (switch at the top of the dashboard). Meta: "Apps must be set to Live … to receive webhook
   notifications". In Development mode, only people with a role on the app (admin, developer, tester) can message the bot.
6. **System user + permanent token.** Business settings > Users > System users > Add (Admin). Then:
   - **Assign assets**: the Page (full control), the Instagram account and the WhatsApp account. Assign the app too.
   - **Generate token**: pick the app and **Never** expire. Tick the permissions from the table below. Copy the token.
     It is shown once.
   - This token starts with `EAA…` and does not expire. Prefer it over tokens from Graph API Explorer, which expire in hours or 60 days.

### Permissions per channel (request **Advanced access** in App Review for all of them)

| Channel | Permissions | Notes |
| --- | --- | --- |
| WhatsApp | `whatsapp_business_messaging`, `whatsapp_business_management` (+ `business_management` for system-user tokens) | |
| Messenger | `pages_messaging`, `pages_manage_metadata`, `pages_show_list`, `pages_read_engagement` (not verified that the last two are still required) | `pages_manage_metadata` lets the app subscribe to the Page webhooks. |
| Instagram (through the Page) | `instagram_basic`, `instagram_manage_messages`, `pages_manage_metadata`, `pages_show_list` | Meta's IG get-started lists the first three. |
| Instagram (Instagram Login, alternative) | `instagram_business_basic`, `instagram_business_manage_messages` | The token expires after 60 days. **Not recommended** here: the app does not renew it. |
| Human agent (optional) | **Human Agent** feature | Needs App Review and Business Verification. Then set `META_HUMAN_AGENT=1`. |

**App Review:** for each permission, Meta asks for a screencast and a description. Show this flow: a customer writes →
the bot answers → "quiero hablar con una persona" → an agent answers from the Inbox. Explain that the bot only gives
**order status** and never asks for payment data.

---

## 3. Webhook (once per app, for all three products)

In the app dashboard, each product has its own Webhooks / Configuration screen:

| Product screen | Callback URL | Verify token | Subscribe these fields |
| --- | --- | --- | --- |
| WhatsApp > Configuration | `https://inbox.yourdomain.com/api/webhooks/meta` | the `META_VERIFY_TOKEN` value | `messages` (includes delivery status and failures) |
| Messenger > Settings > Webhooks (object **Page**) | same | same | `messages`, `messaging_postbacks` |
| Instagram > Webhooks (object **Instagram**) | same | same | `messages`, `messaging_postbacks` (echoes come with `messages`) |

You can copy both values from the app: **Canales > "Para tu equipo técnico"**. When you click "Verify and save",
Meta calls our address. It works only if the tunnel (step 1) is up and `META_VERIFY_TOKEN` matches exactly.

Our app subscribes each account (WABA, Page, Instagram) automatically when you press **Conectar y probar** in Canales
(`POST /{id}/subscribed_apps`). If that step fails, you see "La clave funciona, pero Meta no nos dejó activar los avisos…"
(see Troubleshooting).

---

## 4. Each channel: create, connect, test

### 4a. WhatsApp

1. App dashboard > WhatsApp > **API Setup**. Meta gives you a **test number**. It can only message up to 5 phone
   numbers that you add as recipients and verify with a code. Good for a first test.
2. **Real number:** WhatsApp Manager > Phone numbers > Add. Use a number that is NOT active in the WhatsApp app (or
   migrate it). Set the display name and wait for its approval. Register the number (two-step PIN).
3. Payment method in WhatsApp Manager. Needed for template messages. Replies inside 24 h are customer-service messages.
4. **In our app: Canales > WhatsApp > Conectar**:
   - "Número de tu línea (ID)" = **Phone number ID** (API Setup or WhatsApp Manager > Phone numbers). It is NOT the phone number.
   - "Clave de acceso" = the system-user token (step 2.6).
   - "ID de tu cuenta de WhatsApp Business" = **WhatsApp Business Account ID** (API Setup).
   - The app checks the number and the account, then subscribes the app to the account.
5. **Test:** from an allowed phone, send "¿Cuánto dura la garantía?" to the number. In 1 to 5 s the bot answers and the
   chat shows up in **Bandeja** with the WhatsApp label. Send a photo: the bot says a person will review it, and the
   chat goes to "needs human".
6. **24-hour rule:** a free-text reply is allowed only within 24 h of the customer's last message. After that, the app
   blocks the reply with "outside_24h_window_template_required". Meta would need an approved **template**, and the app
   does not send templates yet.

### 4b. Messenger (Facebook Page)

1. The Page must be in the business portfolio, and the system user must have it assigned (step 2.6).
2. **In our app: Canales > Messenger > Conectar**:
   - "ID de tu página": Page > Settings > Page information > **Page ID** (or Meta Business Suite > Settings > Business assets).
   - "Clave de acceso": the system-user token. It must be a token that can act as the Page. A token from "a user" is
     rejected when the app subscribes the Page.
3. **Test:** with a Facebook account that has a role in the app (in Development mode), or with anyone (Live mode plus
   Advanced access), write to the Page. The bot answers within seconds.
4. **Window:** replies are `messaging_type: RESPONSE` inside 24 h. After 24 h, a person can answer up to 7 days only
   with the Human Agent permission plus `META_HUMAN_AGENT=1`. Otherwise the app refuses with "outside_24h_window".
   Text above 2,000 characters is split into several messages.

### 4c. Instagram (professional account linked to the Page)

1. In the Instagram app: switch the account to **Professional** (Business). Link it to the Facebook Page
   (Page settings > Linked accounts, or Meta Business Suite).
2. In the Instagram app: Settings > Messages and story replies > Message controls > Connected tools > **Allow access
   to messages** = ON. If this is off, no message reaches us.
3. **Instagram account ID** (the one webhooks use): in Graph API Explorer with the token, run
   `GET /{page-id}?fields=instagram_business_account`. The `id` (usually starts with `1784…`) is what you paste. Meta
   Business Suite > Settings > Instagram accounts also shows it (not verified that the number there is the same id).
4. **In our app: Canales > Instagram > Conectar**: the Instagram account ID plus the system-user token (EAA…). The app
   checks the account and subscribes the Page (`/me/subscribed_apps`).
   - Alternative: an Instagram Login token (starts with `IG…`). The app then uses `graph.instagram.com`. That token
     expires in 60 days and the app does NOT renew it, so do not use it for production.
5. **Test:** from a different Instagram account, send a DM. Also try a story reply and an ice-breaker tap. They arrive as text.
6. **Limits:** 1,000 bytes per message (accents count as 2 bytes, emojis as 4). The app splits longer replies. The
   24 h and 7-day rules are the same as Messenger.
7. Story mentions and shared reels arrive as "[Publicación compartida]" and go to a person.

---

## 5. Data deletion and privacy (Meta)

- The callback `https://inbox.yourdomain.com/api/webhooks/meta/data-deletion` is in the app (step 2.4). Meta sends a
  signed request. The app deletes the customer's conversations and returns a status link (see `docs/RUNBOOK.md` section 6).
- The Privacy Policy URL must open without a login and must mention Messenger/Instagram/WhatsApp, OpenAI and the
  hosting as processors (RUNBOOK section 8).

---

## 6. Shopify (order status)

**What changed:** Shopify **no longer lets merchants create new "custom apps" in the store admin**
(Settings > Apps > Develop apps). Existing ones keep working with their `shpat_…` token. New setups use a
**Dev Dashboard** app.

### Recommended: Dev Dashboard app + Client ID/secret (client credentials grant)

This works when the app and the store belong to the **same Shopify organization**, which is true when Chefman's store
owner creates the app. The token lasts 24 h, and our app renews it automatically.

1. Log in with the **store owner** (or a staff account with app development rights). Go to Settings > Apps >
   Develop apps > **Build apps in Dev Dashboard** (or dev.shopify.com). (The exact menu labels are not verified.)
2. **Create app**. In the app **version**:
   - Access scopes: **`read_orders`** only.
   - Optional: `read_all_orders`, to see orders older than 60 days. Without it, the bot says "si tu pedido tiene más de
     60 días…" and offers a person. Public apps need Shopify's approval for it. For a merchant's own app we could not verify.
   - **Protected customer data**: select **Email** (level 2). Without it, Shopify returns the order email as empty and
     the bot can never confirm an order. Shopify's table says level 1 and 2 data are "always available" to custom apps,
     but you still have to select the fields (not verified for Dev Dashboard apps).
3. **Release** the version, then **Install** the app on the store.
4. In the app **Settings**, copy the **Client ID** and **Client secret**.
5. **In our app: Complementos > Conectar mi tienda Shopify**:
   - Store domain: `chefman-mx.myshopify.com`. It must be the `.myshopify.com` domain, not the public domain.
   - Choose "Con una app del Dev Dashboard". Paste the Client ID and the Client secret, then click "Verificar y conectar".
6. **Test** in Complementos > "Probar con un pedido": use a real recent order number (`#1234` or `1234`) and its email.
   - "Tu pedido está: …" means it works.
   - "Shopify no deja a la app ver el correo…" means step 2 (protected data: email) is missing.
   - "No encontramos ese pedido" for a known order means: check that the order is less than 60 days old, and check the email.

### Existing legacy custom app (`shpat_…`)

Choose "Con una clave shpat_" and paste it. If the token is lost, the app must be reinstalled to make a new one
(Shopify shows it only once).

### One-click OAuth (only if `SHOPIFY_API_KEY`/`SHOPIFY_API_SECRET` are set)

Uses `https://{shop}/admin/oauth/authorize` → callback `https://inbox.yourdomain.com/api/shopify/callback` (add that
exact URL to the app's allowed redirect URLs) → `POST https://{shop}/admin/oauth/access_token`. The callback is
checked with Shopify's HMAC (sorted parameters, without `hmac`, HMAC-SHA256 with the client secret). A **known
limitation** remains: the admin panel runs on `localhost` but the callback lands on the public address, so the browser
cookie is missing. Use the Dev Dashboard method above instead.

### Shopify compliance webhooks

Public apps must handle `customers/data_request`, `customers/redact` and `shop/redact`. These webhooks are **not
built yet** (see `docs/STATUS.md`). For a merchant's own custom app, Shopify does not require them (not verified), but
handle deletion requests by hand with `npm run delete-customer`.

---

## 7. Final end-to-end test (all channels)

For each channel, from a real customer account (not an admin of the app):
1. "Hola": the greeting arrives.
2. "¿Dónde está mi pedido?" → order number → email: the real Shopify status arrives.
3. "Quiero hablar con una persona": the handoff message arrives. The chat shows "needs human" in Bandeja, and a file
   appears in `DATA_DIR/outbox/`.
4. In Bandeja: "Take" → type a reply → it arrives on the phone.
5. Send a photo or voice note: the "a person will review it" reply arrives.
6. Check the server log: no `[meta webhook] rejected` lines.

---

## 8. Troubleshooting

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| Meta "Verify and save" fails | Tunnel down, wrong path, or `META_VERIFY_TOKEN` differs | Open `…/api/webhooks/meta?hub.mode=subscribe&hub.verify_token=<token>&hub.challenge=123`: it must show `123`. Restart the app after editing `.env.local`. |
| Log: `[meta webhook] rejected: bad_signature` | `META_APP_SECRET` is from another app, or was rotated | Copy the App secret again (App settings > Basic). For Instagram Login apps, also set `META_IG_APP_SECRET`. |
| Log: `rejected: no_app_secret` / `missing_signature` | `META_APP_SECRET` empty | Set it and restart. Unsigned calls are always refused on a public address. |
| Webhook never fires (verify OK, no messages) | App not **Live**; field not subscribed; account not subscribed; Instagram "Allow access to messages" off; Page/IG not in the system user's assets | Check steps 2.5, 3 and 4c.2. Press "Cambiar datos" → "Conectar y probar" again in Canales: this re-subscribes the account. |
| Messages from you arrive, from customers don't | App in Development mode, or Advanced access not approved | Go Live and finish App Review. |
| Canales: "Meta no aceptó la clave" | Token expired (code 190): Explorer/user tokens expire | Use a system-user token with **Never** expire. |
| Canales: "La clave funciona, pero Meta no nos dejó activar los avisos…" | Not a Page token (Messenger/IG), or missing `pages_manage_metadata` / `whatsapp_business_management` | Regenerate the system-user token with those permissions and with the asset assigned. |
| Inbox reply fails: `outside_24h_window_template_required` (WhatsApp, Meta code **131047**) | The customer's last message is older than 24 h | Ask the customer to write again, or (later) send an approved template. The app does not send templates yet. |
| Inbox reply fails: `outside_24h_window` (Messenger/IG) | More than 24 h passed and Human Agent is not enabled | Get Human Agent approved, then set `META_HUMAN_AGENT=1` (7-day window). |
| Log: `whatsapp delivery failed code=131047` | Same as above, reported asynchronously by Meta | Same as above. |
| `recipient_not_in_test_allowed_list` (code 131030) | Using the WhatsApp **test number** with an unlisted phone | Add and verify the phone in API Setup (max 5), or use the real number. |
| `token_expired_or_invalid` while running | Token revoked, password changed, or a 60-day IG token expired | Generate a new system-user token and reconnect the channel. |
| Shopify test: "no deja a la app ver el correo" | Protected customer data (email) not selected/approved | Dev Dashboard → app version → protected customer data: Email → release and reinstall. |
| Shopify test: always "No encontramos" | Order older than 60 days without `read_all_orders`; wrong email; store domain is not the `.myshopify.com` one | Try a recent order. Check the email on the order in Shopify admin. |
| Shopify connect: "no aceptó el Client ID o el Client secret" | App not installed on that store, or the app belongs to another organization | Install the released version on the store. Create the app from the store owner's organization. |
| Shopify OAuth returns "No pudimos conectar la tienda" | localhost cookie vs public callback (known limitation) | Use the Dev Dashboard method. |

---

## 9. What was verified against the official docs (2026-10-06), and what was not

**Verified** on developers.facebook.com / shopify.dev, and the code was matched to it:
- GET handshake (`hub.mode`, `hub.verify_token`, `hub.challenge`).
- `X-Hub-Signature-256` over the payload, including the escaped-unicode note.
- Payloads up to 3 MB. Apps must be Live to get webhooks.
- WhatsApp message and status shapes, including failed statuses with `errors[].code`.
- WhatsApp text limit 4096 and the 24 h window. Error codes 131047 / 131026 / 131056 / 190.
- Messenger send endpoint `/{PAGE-ID}/messages`, `messaging_type` RESPONSE / MESSAGE_TAG, `HUMAN_AGENT` (7 days, needs App Review).
- Instagram webhook fields: `entry.id` / `recipient.id` = IG professional account. Attachment types (incl. `ephemeral`), postbacks.
- Instagram send via `/me/messages` with a Page token, or `graph.instagram.com/{IG_ID}/messages` with an Instagram user token.
- Instagram limit of 1000 (bytes, for Instagram Login). Instagram Login `user_id` = webhook id.
- `subscribed_apps` for WABA, Page and Instagram Login.
- Graph API versions (v25.0/v26.0).
- Shopify: API versions; custom apps can no longer be created in admin; client credentials grant (form-encoded, 24 h token).
- Shopify: OAuth HMAC procedure, authorize URL, token exchange. `expiring=1` is required only for public apps.
- Shopify: `Order.email`; `displayFulfillmentStatus` / `displayFinancialStatus` enums; `fulfillments(first:)`; `trackingInfo`.
- Shopify: `name:#1001` search example; the 60-day default window; protected customer data returns null plus an error.

**Not verified** (left defensive in code, or flagged above):
- Which secret signs Instagram-Login webhooks (we accept `META_APP_SECRET` or `META_IG_APP_SECRET`).
- Whether Messenger-platform Instagram webhooks put the IG id or the Page id in `entry.id` (the docs disagree). The app routes by both.
- Instagram Login + `HUMAN_AGENT` body format.
- Messenger error subcode for "outside window" (2018278 from memory; 2534022 for Instagram from memory).
- That `customer { email }` on Order needs `read_customers`. We stopped asking for it; `Order.email` is enough.
- Whether `name:1001` (without `#`) matches. The app sends `name:#1001 OR name:1001`.
- Dev Dashboard menu labels and how protected-data selection works for merchant-owned apps.
- Whether `read_all_orders` needs approval for merchant-owned apps.
- ngrok path-restriction syntax.
- Current app-creation use-case names in the Meta dashboard.
- Whether `pages_read_engagement` is still required.
