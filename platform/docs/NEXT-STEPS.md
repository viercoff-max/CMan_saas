# Siguientes pasos (para el dueño) — actualizado 2026-11-20

Estado: el MVP está **en línea** en https://conversa-mvp.vercel.app (Vercel Hobby + Supabase `Vicame_saas`).
Probado en línea el 2026-11-20: registro y confirmación de correo, panel de plataforma, contexto, Claude Haiku real,
escalamiento por seguridad con retención legal y un bot de Telegram real (@ConversaDemoBot).

## Cambios del 2026-11-20 (noche), todavía SIN commit ni deploy
1. **Contexto → «Opción rápida»**: arriba de las secciones hay una tarjeta para subir UN archivo con todo el contexto
   (PDF, DOCX, TXT, MD, CSV o HTML, máx. 10 MB). Se guarda como fuente de datos general y el asistente busca en él lo que
   necesita. Las secciones quedan como opcionales ("Afinar por secciones").
2. **WhatsApp (beta)** en Canales: formulario con 3 datos (ver abajo). Solo aparece cuando la plataforma tiene
   configurada su app de Meta (`META_APP_SECRET` y `META_VERIFY_TOKEN`); si no, sigue «Próximamente». El sitio público
   sigue diciendo «Próximamente» hasta que Meta apruebe la app.
3. **Negocios demo**: cualquier usuario con sesión puede crear un negocio aparte con datos ficticios (cocina, ropa o
   cafetería) desde «+ Crear negocio demo» (menú lateral) o desde el registro. Un aviso amarillo indica que es demo y la
   persona dueña puede borrarlo completo. Límite: 5 negocios por cuenta (los demo cuentan) y 10 demos por día.
   No se borra si tiene una conversación REAL con retención legal.

Verificado: typecheck, lint (0 errores), 874/874 pruebas, `next build`, y en Supabase (transacción revertida) que borrar
un negocio elimina en cascada todas sus tablas. **No verificado**: las pantallas nuevas en el navegador con sesión,
crear/borrar un demo de punta a punta en línea, y WhatsApp real (falta la app de Meta).

## WhatsApp: qué configura la PLATAFORMA (una sola vez, tú)
1. En developers.facebook.com crea una app tipo **Business** y agrega el producto **WhatsApp**.
2. En la app → WhatsApp → Configuración → Webhook:
   - URL de devolución: `https://conversa-mvp.vercel.app/api/webhooks/meta`
   - Token de verificación: una frase larga inventada por ti (la misma que pondrás en `META_VERIFY_TOKEN`).
   - Suscribe el campo **messages**.
3. En Vercel → Settings → Environment Variables (Production) agrega:
   - `META_VERIFY_TOKEN` = la frase del paso 2
   - `META_APP_SECRET` = app → Configuración → Básica → «Clave secreta de la app»
   Después haz Redeploy. Desde ese momento aparece el formulario de WhatsApp en Canales.
4. Para vender a otros negocios Meta exige que la app pase revisión (permisos `whatsapp_business_messaging` y
   `whatsapp_business_management`) y, idealmente, registrarte como Tech Provider para usar «Embedded Signup»
   (un botón de «Conectar con Facebook» en lugar de copiar datos). Eso queda pendiente.

## WhatsApp: qué pone CADA NEGOCIO en Canales → WhatsApp (como el token de Telegram)
| Campo | Dónde se obtiene |
|---|---|
| **ID del número de teléfono** (Phone number ID) | business.facebook.com → Administrador de WhatsApp → Números de teléfono → el número largo «ID del número de teléfono» (no es el celular) |
| **ID de la cuenta de WhatsApp Business** (WABA ID) | Administrador de WhatsApp, junto al nombre de la cuenta |
| **Clave de acceso permanente** (token, empieza con EAA) | Configuración del negocio → Usuarios del sistema → usuario administrador con la cuenta de WhatsApp asignada → «Generar token» con la app de la plataforma, caducidad «Nunca», permisos `whatsapp_business_messaging` y `whatsapp_business_management` |

Al tocar «Conectar y probar» la app comprueba el número y la cuenta con Meta, suscribe la app a los mensajes de esa
cuenta y guarda la clave cifrada. Regla de WhatsApp: se responde libre durante 24 h desde el último mensaje del cliente;
después se necesitan plantillas aprobadas (todavía no implementadas).
Para probar sin un número real: en la app de Meta, WhatsApp → «Configuración de API» da un **número de prueba**, su ID,
el WABA ID y un token temporal (24 h); agrega tu celular como destinatario de prueba.

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
