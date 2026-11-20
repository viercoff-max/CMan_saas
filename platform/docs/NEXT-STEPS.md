# Siguientes pasos (para el dueño) — actualizado 2026-11-20

Estado: el MVP está **en línea** en https://conversa-mvp.vercel.app (Vercel Hobby + Supabase `Vicame_saas`).
Probado en línea el 2026-11-20: registro y confirmación de correo, panel de plataforma, contexto, Claude Haiku real,
escalamiento por seguridad con retención legal y un bot de Telegram real (@ConversaDemoBot).

## Publicado el 2026-11-20 (commits 517feef y siguiente)
1. **Contexto → «Opción rápida»**: subir UN archivo con todo el contexto (PDF, DOCX, TXT, MD, CSV o HTML, máx. 10 MB).
   Se guarda como fuente de datos general; las secciones quedan como opcionales ("Afinar por secciones").
2. **WhatsApp (beta), conexión MANUAL** con la app de Meta de cada negocio (ver abajo). No necesita configuración de la
   plataforma. El sitio público y los planes ya dicen «WhatsApp (beta)».
3. **Negocios demo**: «+ Crear negocio demo» (menú lateral o registro), plantillas cocina / ropa / cafetería, aviso
   amarillo y botón para borrarlo (solo la persona dueña). Límite: 5 negocios por cuenta y 10 demos por día. No se borra
   si tiene una conversación REAL con retención legal.
4. **Configuración asistida** (soporte con costo adicional): ofrecida en Canales → WhatsApp, en Plan y uso y en Precios.
   El contacto sale de `supportEmail` en `src/lib/platform/brand.ts` (vacío hoy: se muestra «muy pronto»). **Llénalo.**

Verificado: typecheck, lint (0 errores), 889/889 pruebas (incluye firma, token y aislamiento entre negocios del webhook
de WhatsApp), `next build`, borrado en cascada en Supabase (transacción revertida) y las pantallas en línea.
**No verificado**: WhatsApp con una app de Meta y un número reales; crear/borrar un demo en línea.

## WhatsApp manual: qué hace CADA NEGOCIO (o tu equipo, como servicio de soporte)
**Paso 1, en Meta (developers.facebook.com):** crear una app tipo «Empresa», agregar el producto WhatsApp, agregar y
verificar su número, y publicar la app (modo «Live»; en desarrollo solo responde a números de prueba).

**Paso 2, en Canales → WhatsApp (4 datos):**
| Campo | Dónde se obtiene |
|---|---|
| **ID del número de teléfono** | App de Meta → WhatsApp → Configuración de API (no es el celular) |
| **ID de la cuenta de WhatsApp Business** (WABA ID) | Mismo lugar, o Administrador de WhatsApp junto al nombre de la cuenta |
| **Clave de acceso permanente** (EAA…) | business.facebook.com → Configuración del negocio → Usuarios del sistema → usuario administrador con la cuenta de WhatsApp asignada → «Generar token» con SU app, caducidad «Nunca», permisos `whatsapp_business_messaging` y `whatsapp_business_management` |
| **Clave secreta de la app** (App Secret) | App de Meta → Configuración de la app → Básica → «Clave secreta de la app» |

«Conectar y probar» comprueba número y cuenta con Meta, suscribe SU app a los mensajes de esa cuenta y guarda todo
cifrado.

**Paso 3, de vuelta en Meta:** la tarjeta muestra una **dirección de webhook propia del negocio**
(`https://conversa-mvp.vercel.app/api/webhooks/whatsapp/<id>`) y un **token de verificación** generado. Se pegan en
App → WhatsApp → Configuración → Webhook («Verificar y guardar») y se suscribe el campo **messages**. La tarjeta pasa a
«Webhook verificado».

Seguridad: cada mensaje se acepta solo si la firma `X-Hub-Signature-256` (sobre el cuerpo original) coincide con la
clave secreta de ESE negocio, y solo para su propio número; si no, 403. Regla de WhatsApp: respuestas libres durante 24 h
desde el último mensaje del cliente; después se necesitan plantillas (pendiente).
Prueba sin número real: App → WhatsApp → Configuración de API da un número de prueba y un token temporal (24 h); agrega
tu celular como destinatario de prueba.

## WhatsApp con la app de la PLATAFORMA (opcional, más adelante)
Si configuras `META_APP_SECRET` y `META_VERIFY_TOKEN` en Vercel (webhook `/api/webhooks/meta`), la clave secreta
deja de ser obligatoria para los negocios. Para vender así a terceros Meta exige revisión de la app y, idealmente,
«Embedded Signup» (botón «Conectar con Facebook»). Pendiente.

## Pendiente antes de vender
- SMTP propio (p. ej. Resend) para correos de confirmación sin el límite de Supabase y para editar plantillas; CAPTCHA.
- Nombre comercial y datos legales en `src/lib/platform/brand.ts`; revisión de un abogado; luego `LEGAL_DRAFT = false`
  y `SITE_INDEXABLE = true`.
- Acuerdos de datos: Anthropic, Supabase, Vercel, Telegram/Meta; contrato de encargado con cada cliente.
- Vercel Pro (Hobby no permite uso comercial); proyecto de Supabase separado para producción; programar la purga diaria.
- Activar 2FA en Vercel, Supabase, GitHub y Anthropic.
- Borrar la carpeta vieja de OneDrive (`C:\Users\elect\OneDrive\Desktop\Proyectos`).

## Pendiente técnico conocido
- Plantillas de WhatsApp (fuera de 24 h), Embedded Signup, Instagram y Messenger («Próximamente»).
- Cobros (Stripe/CFDI) y límites por plan.
- Prueba en vivo del contrato de datos: `RUN_LIVE=1` contra un proyecto de prueba.
- Detalles menores en `docs/REQUESTS.md`, `docs/REVIEW-qa-2.md` y `docs/REVIEW-security-2.md`.
