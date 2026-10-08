# Runbook: running the Social Inbox on our own computer (on-prem)

Plain steps for the person who runs the server. Commands are for Windows (PowerShell), run from the project folder.

## 1. Move everything out of OneDrive (do this once, before real customers)

**Status (2026-10-08):** the project now lives outside OneDrive, at `C:\dev\Proyectos\Momentia\Chefman_Saas\platform`. What is still open: the OLD copy at `C:\Users\elect\OneDrive\Desktop\Proyectos` still syncs the database, `.env.local` and the uploads to Microsoft's cloud (step 6, owner action), and the secrets that were synced must be rotated (step 8).

1. Stop the app.
2. ~~Copy the project folder to a non-synced place.~~ Done: use `C:\dev\Proyectos\Momentia\Chefman_Saas\platform`. Optionally keep `DATA_DIR` outside the project folder too (steps 3 to 5).
3. Create the data folder: `C:\ProgramData\SocialInbox\data`.
4. Move the contents of the old `data\` folder (`app.db`, `app.db-wal`, `app.db-shm`, `uploads\`, `outbox\`) into `C:\ProgramData\SocialInbox\data`.
5. In `C:\SocialInbox\platform\.env.local` add the line `DATA_DIR=C:\ProgramData\SocialInbox\data`.
6. Delete the old OneDrive copy (`C:\Users\elect\OneDrive\Desktop\Proyectos`; the owner does this, nothing in it is missing from `C:\dev\Proyectos`), then empty the OneDrive recycle bin and check the online recycle bin at onedrive.com.
7. Restrict access to that folder: right-click `C:\ProgramData\SocialInbox`, Properties, Security, leave only Administrators and the Windows user that runs the app. Turn on BitLocker for the disk.
8. **Rotate the secrets.** They were already synced, so treat them as exposed:
   - `ADMIN_PASSWORD`: run `npm run set-password -- admin@chefman.local`. It prints a new password once; save it in a password manager. Then **delete the `ADMIN_PASSWORD=` line** from `.env.local` (it is only used the first time).
   - `APP_SECRET`: put a new random value (run `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`). This logs everyone out and makes the stored Shopify and Meta tokens unreadable, so afterwards **reconnect Shopify (Add-ons) and every channel (Channels)**.
   - `META_APP_SECRET`, Shopify API secret, `OPENAI_API_KEY`: rotate them in the Meta, Shopify and OpenAI dashboards and paste the new values.

## 2. Run in production mode (never `npm run dev` for real customers)

`npm run dev` shows error details and source code to anyone and turns off several protections.

- First time and after every update: `npm run build`
- Start: `npm start -- -H 127.0.0.1` (listens only on this computer, port 3000)
- Or both in one step: `npm run start:prod`

To start it automatically when Windows boots, create a scheduled task "At startup" that runs `cmd /c cd /d C:\SocialInbox\platform && npm start -- -H 127.0.0.1`, under the Windows user that owns the folder.

The admin panel is used from this computer only: open `http://localhost:3000`. Do not open it through the public tunnel address.

## 3. The public tunnel: expose only two paths

Meta and Shopify must reach us from the Internet; nothing else should. With Cloudflare Tunnel (`cloudflared`), use a config like this (`config.yml`):

```yaml
tunnel: <your-tunnel-id>
credentials-file: C:\ProgramData\SocialInbox\cloudflared\<your-tunnel-id>.json
ingress:
  - hostname: inbox.yourdomain.com
    path: ^/api/webhooks/meta(/.*)?$        # Meta messages + Meta data-deletion callback
    service: http://127.0.0.1:3000
  - hostname: inbox.yourdomain.com
    path: ^/api/shopify/callback$            # Shopify one-button connect (only if you use it)
    service: http://127.0.0.1:3000
  - service: http_status:404                 # everything else (login, inbox, settings) is NOT public
```

Set `PUBLIC_URL=https://inbox.yourdomain.com` in `.env.local`. Because it starts with `https://`, the login cookie is marked Secure.

Shopify note: the one-button Shopify connect starts on `localhost` but Shopify sends the browser back to the public address, where the browser does not have the localhost cookie, so it fails. Use **"Conexión manual"** (custom app token) in Add-ons instead. (Raised for the Shopify module in `docs/REQUESTS.md`.)

## 4. Backups

- `npm run backup` makes a safe copy of the database while the app runs (in `C:\ProgramData\SocialInbox\backups`, the newest 14 are kept). `npm run backup -- D:\Backups\SocialInbox` saves to another disk.
- Backups contain customer data: keep them on a BitLocker disk, never in OneDrive or Google Drive.
- Test a restore once a month: stop the app, copy a backup over `app.db` in a test folder, start with `DATA_DIR` pointing there, log in.
- Also copy the `uploads` folder (brand documents) after you add new files: `robocopy C:\ProgramData\SocialInbox\data\uploads D:\Backups\SocialInbox\uploads /MIR`.
- Keep a copy of `.env.local` in the password manager (not on the backup disk next to the database).

## 5. Data retention (daily)

`npm run purge` deletes conversations older than `RETENTION_DAYS` (default 90; never less than 30), deletes outbox notification files older than 30 days, and cleans old login attempts. Conversations escalated for **safety** or **legal** reasons are kept (legal hold); their text is masked after 365 days.

Schedule it every night at 3:00 (PowerShell as administrator, one line):

```
schtasks /Create /SC DAILY /ST 03:00 /TN "SocialInbox purge" /TR "cmd /c cd /d C:\SocialInbox\platform && npm run purge >> C:\ProgramData\SocialInbox\purge.log 2>&1" /RU %USERNAME%
```

## 6. A customer asks for their data or asks to be deleted (ARCO, Meta, Shopify)

Get the customer's channel and id from the inbox (Messenger/Instagram id or WhatsApp number).

- Copy of their data: `npm run delete-customer -- instagram 1234567890 --export-only --export datos.json`. Send the file, then delete it.
- Delete: `npm run delete-customer -- instagram 1234567890`. If it says a conversation is on legal hold (safety/legal), ask the owner before re-running with `--force`.
- Answer within 20 business days (LFPDPPP). Every action leaves an audit entry without personal data.
- Meta's automatic data-deletion requests arrive at `/api/webhooks/meta/data-deletion` and are handled the same way.

## 7. Login protection

After 5 wrong passwords for one email (or 10 from one network address) in 15 minutes, login is blocked for that email/address until the 15 minutes pass. The screen only says "wrong email or password". To unlock sooner, wait or run `npm run set-password`.

## 8. Before production checklist

- [ ] Everything moved out of OneDrive, folder access restricted, BitLocker on, secrets rotated (section 1).
- [ ] Running with `npm run build` + `npm start` (section 2), never `npm run dev`.
- [ ] Tunnel exposes only `/api/webhooks/meta…` and `/api/shopify/callback` (section 3).
- [ ] `META_APP_SECRET` set (unsigned webhooks are rejected).
- [ ] Nightly `npm run purge` and `npm run backup` scheduled; one restore tested.
- [ ] **Meta App Review** approved for the messaging permissions (`pages_messaging`, `instagram_manage_messages`, `whatsapp_business_messaging` if used), with Business Verification.
- [ ] **Privacy Policy URL** set in the Meta app (Settings > Basic) and in Shopify, pointing to Chefman's notice.
- [ ] **Data Deletion Callback URL** in the Meta app: `https://inbox.yourdomain.com/api/webhooks/meta/data-deletion`.
- [ ] **Aviso de privacidad** (integral) published by Chefman, naming Momentia, OpenAI and the hosting as processors, the purposes, ARCO contact and how to opt out of product suggestions. The first bot message links to it.
- [ ] **DPA with OpenAI** signed (and zero data retention requested if available); contract (encargo) between Chefman and Momentia signed.
- [ ] Shopify: Protected Customer Data access approved; compliance webhooks (`customers/data_request`, `customers/redact`, `shop/redact`) wired.
- [ ] A named person checks the human-handoff queue during business hours.
