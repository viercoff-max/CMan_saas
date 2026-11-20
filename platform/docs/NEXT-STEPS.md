# Siguientes pasos (para el dueño) — 2026-11-20

Estado: el MVP SaaS está construido y probado **localmente** (SQLite y simulaciones). Base de datos de Supabase
(`Vicame_saas`, us-east-1) con 11 migraciones aplicadas y 70 verificaciones SQL pasando (todas revertidas al final).
`main` está en GitHub (`viercoff-max/CMan_saas`). Nada está publicado (sin deploy).

**Verificado:** typecheck sin errores, lint 0 errores, 855/855 pruebas, build de producción, `npm audit` 0 vulnerabilidades,
revisión en navegador (modo SQLite) de todas las pantallas.
**NO verificado todavía:** la app en modo Supabase de punta a punta (registro, correo de confirmación, invitaciones),
Telegram real, Claude real, Shopify real.

## 1. Tus claves en `platform/.env.local` (las escribes tú; nunca en el chat)
| Variable | Valor |
|---|---|
| `DATA_BACKEND` | `supabase` |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://mtujcjprgvqmnushpoph.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase → Project Settings → API Keys (publishable) |
| `SUPABASE_SECRET_KEY` | Supabase → API Keys (secret). **Secreta** |
| `ANTHROPIC_API_KEY` | console.anthropic.com, con **límite de gasto mensual**. **Secreta** |
| `PUBLIC_URL` | la dirección https pública (túnel) cuando pruebes Telegram |
| `APP_SECRET` | ya existe; respáldala en un gestor de contraseñas (cifra los tokens de todos los clientes) |
Opcionales: `ANTHROPIC_MODEL` (vacío = `claude-haiku-5-5`), `PLATFORM_DAILY_TOKEN_CAP`, `TRUSTED_PROXY_HEADERS`.

## 2. Ajustes en el panel de Supabase (Authentication)
1. URL Configuration: Site URL = `PUBLIC_URL`; Redirect URLs = `<PUBLIC_URL>/auth/confirm` y `http://localhost:3000/auth/confirm`.
2. Activar confirmación de correo; desactivar inicios de sesión anónimos.
3. Plantillas de correo:
   - Confirm signup: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
   - Reset password: `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/login/reset`
4. Política de contraseñas y revisión de contraseñas filtradas; SMTP propio (p. ej. Resend) y CAPTCHA (Turnstile/hCaptcha).
5. Cuando te registres, dime tu correo y te agrego como admin de la plataforma (`/platform`), con tu aprobación.

## 3. Telegram (canal del MVP)
1. En Telegram abre @BotFather → `/newbot` → copia el token.
2. Expón la app con un túnel https (ver `docs/RUNBOOK.md`, solo las rutas de webhooks) y pon esa dirección en `PUBLIC_URL`.
3. En la app: Canales → Telegram → pega el token → «Conectar y probar». Detalle: `docs/GO-LIVE.md` sección 10.

## 4. Antes de vender / publicar
- Nombre comercial (hoy «Conversa», provisional) y datos legales en `src/lib/platform/brand.ts` (razón social, correo de
  privacidad, domicilio); revisión de un abogado; luego `LEGAL_DRAFT = false` y `SITE_INDEXABLE = true`.
- Acuerdos de datos: Anthropic, Supabase, Vercel, Telegram/Meta; y contrato de encargado con cada cliente.
- Proyecto de Supabase separado para producción; programar la purga diaria (pg_cron o Vercel Cron).
- Deploy en Vercel (plan Pro para uso comercial): **solo con tu aprobación**.
- Borrar la carpeta vieja de OneDrive (`C:\Users\elect\OneDrive\Desktop\Proyectos`), que sigue sincronizando secretos
  (incluye una carpeta `.playwright-mcp` con registros de la revisión en navegador).

## 5. Pendiente técnico conocido (no bloquea la demo)
- Plantillas de WhatsApp y canales Meta (marcados «Próximamente»).
- Cobros (Stripe/CFDI) y límites de conversaciones/asientos por plan.
- Prueba en vivo del contrato de datos: `RUN_LIVE=1` contra un proyecto de prueba.
- Detalles menores listados en `docs/REQUESTS.md`, `docs/REVIEW-qa-2.md` y `docs/REVIEW-security-2.md` (secciones «Fix status»).
