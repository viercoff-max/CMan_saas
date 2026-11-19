# Conversa: clickable prototype (mockups only)

This is a static HTML prototype of the multi-tenant customer-chat SaaS. It is **not** the real app: there is no backend, and nothing here is imported by `platform/`. "Conversa" is a placeholder name (nombre provisional). Every person, email and store in it is made up (`example.com`).

## Open it
Serve the folder with any static server and open `index.html`. Opening the file directly also works, but fonts load from Google Fonts.

- Pick the brand with `?brand=chefman` or `?brand=aurora`.
- Pick the screen with the hash, for example `index.html?brand=aurora#inbox`.
- Add `&capture=1` to hide the small "Prototipo" switcher (bottom-left), which is how the PNGs were made.

## Files
| File | What it holds |
|---|---|
| `index.html` | Page shell and font links |
| `brands.js` | **Brand configs** (`BRANDS`), the platform identity (`PLATFORM`) and the WCAG color math |
| `data.js` | Fictional conversations, sources, team and tenants for each brand |
| `app.js` | Router, tenant shell and the 14 screens |
| `styles.css` | Tokens (neutrals taken from `platform/src/app/globals.css`) and layout |
| `screens/` | Exported PNGs |

## Change or add a brand
Edit `BRANDS` in `brands.js`:

```js
miMarca: {
  id: "miMarca", name: "Mi Marca", tag: "",      // tag shows as "(…)" next to the name
  industry: "Panadería",
  primary: "#1D4ED8",      // buttons and main actions
  accent: "#0F172A",       // team chat bubbles
  background: "#F3F6FD",   // sidebar tint (optional, derived from primary if missing)
  font: "Fraunces",        // headings: "Bricolage Grotesque" | "Fraunces" | "Figtree"
  agent: "Pan", bot: "@MiMarcaBot",
  logo: `<svg viewBox="0 0 40 40">…{{primary}} {{accent}} {{onPrimary}}…</svg>`,
}
```

Then open `?brand=miMarca` (and add a `DATA.miMarca` block in `data.js`, or copy `DATA.chefman`).

`Color.derive()` works out every other token on its own:
- **Text on buttons** (`--b-on-primary`): white or near-black, whichever reaches 4.5:1. Café Aurora's amber gets dark text automatically.
- **Brand color used as text** (`--b-ink`: links, focus ring, the active-nav icon): the primary darkened step by step until it reaches 4.5:1 on white. The #brand screen shows the ratios live.
- Soft tints, hover state and accent text color.

Logo placeholders `{{primary}}`, `{{accent}}` and `{{onPrimary}}` are filled in at render time, so the logo follows color changes in the live preview.

The Chefman logo is an original placeholder (a pan with steam). It is not the real Chefman logo or trademark artwork, and the brand is labeled "marca de prueba".

## Screens
"Built" means the feature already exists in `platform/` today (see `platform/docs/STATUS.md`). "Mockup only" means it is new in this prototype.

| # | Hash | What it shows | Built vs mockup |
|---|---|---|---|
| 01 | `#signup` | Conversa sign-up: Google button, email and password, and a panel showing two tenant brands side by side | Mockup only (today: email/password login, no sign-up, no Google) |
| 02 | `#onboarding` | Step 2 "Tu marca" of the wizard (Negocio, Marca, Canal, Prueba): logo dropzone, color pickers, contrast check, live preview | Mockup only |
| 03 | `#dashboard` | Setup checklist where only the next step is primary, plus KPIs (esperan a una persona, atendidos por el asistente, resueltos, uso de IA del mes) and who is waiting | Checklist and first 3 KPIs built; "Invita a tu equipo" step, AI-usage KPI and the Telegram step are mockup |
| 04 | `#inbox` | List with statuses and Telegram badges, the urgent "mi licuadora echó humo" case, a thread with customer, assistant and team bubbles, the handoff reason, "Responder", "Devolver al asistente", "Marcar como resuelta" | Built (statuses, takeover, reply, filters); Telegram channel and the customer side panel are mockup |
| 05 | `#simulator` | Phone-style test chat with starter chips, a status-only reply for order #1001, and an explanation of what the assistant did | Simulator built; the "Qué hizo tu asistente" trace is mockup |
| 06 | `#context` | 8 sections, the "Escribir / Usar un archivo" switch, Garantía in file mode (`garantia.pdf` with preview), linked sources, "Usando: …" summary | Built |
| 07 | `#tone` | Assistant name, tone slider 1 to 5 with live sample replies, cross-sell level, language, hours, handoff email | Built (named stops on the slider are new) |
| 08 | `#sources` | Files and links with Lista / Leyendo / Con error status and "En Contexto: …" badges | Built (status "Leyendo" is a mockup state) |
| 09 | `#channels` | Telegram connected as `@ChefmanAyudaBot`, BotFather steps, "Conectar y probar"; WhatsApp, Instagram and Messenger "Próximamente" | Mockup only for Telegram (today: Meta channels with ID and token) |
| 10 | `#addons` | Shopify in demo-store mode, privacy note, "Probar con un pedido"; Twilio "Próximamente" | Built |
| 11 | `#brand` | Logo, colors, font, AA contrast report, live preview, "Restablecer" and "Guardar marca". Proves white-label: compare `11-brand-chefman.png` with `11-brand-aurora.png` | Mockup only |
| 12 | `#team` | Members with Admin / Agente roles, a pending invite, invite by email, seats used on the plan | Mockup only |
| 13 | `#billing` | Gratis / Pro / Negocio with "Precio por definir", usage meters (conversaciones, uso de IA with a monthly cap, seats) | Mockup only |
| 14 | `#platform-admin` | Platform owner view with Conversa branding: tenant table (plan, status, channel, conversations this month, AI usage), "Entrar como cliente…" switcher | Mockup only |

The tenant switcher at the top of the sidebar is on every tenant screen (click the business name). It lists the businesses this user belongs to, each with its own logo and role.

## Exported PNGs (`screens/`)
- `01` to `14` with the `-chefman` suffix at 1440 px wide. The window height is set per screen so nothing gets cut off.
- `03-dashboard-aurora.png`, `04-inbox-aurora.png`, `11-brand-aurora.png`.
- `15-inbox-mobile-chefman.png` and `16-simulator-mobile-chefman.png`: a 390x844 viewport with mobile emulation, rendered at 2x (780x1688 px).
