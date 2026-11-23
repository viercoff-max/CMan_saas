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

## Fase 3 publicada el 2026-11-22: ManyChat + Email (visual)
**ManyChat** (Canales → ManyChat, beta). ManyChat sigue con los flujos del negocio; Conversa responde las dudas.
1. El negocio pega su **clave de API de ManyChat** (ManyChat → Settings → API; requiere plan de pago). Probamos la clave
   con `GET /fb/page/getInfo` y la guardamos cifrada.
2. La tarjeta muestra la **dirección** `https://conversa-mvp.vercel.app/api/integrations/manychat/<id>`, el header
   **`Authorization: Bearer <token>`** (generado por nosotros; se puede rotar) y el **Body** a pegar en una acción
   «External Request» del flujo: `subscriber_id` (Contact Id), `name` (Full Name), `text` (Last Text Input) y `channel`
   (instagram / messenger / whatsapp / telegram).
3. Conversa contesta en la misma llamada: `reply`, `needs_human`, `reason`, `status` y un bloque «Dynamic Block v2».
   En ManyChat se mapea `$.reply` a un campo y se envía; `$.needs_human` sirve para pasar el caso al equipo.
4. Las conversaciones quedan en Mensajes (canal ManyChat) con su ficha de cliente. Una respuesta del equipo sale por
   `POST /fb/sending/sendContent`. Fuera de 24 h ManyChat la rechaza (código 3011) y la bandeja lo avisa.
Verificado con la especificación oficial de la API de ManyChat (api.manychat.com/swagger, Page API) y las pruebas
automáticas (endpoint con token, aislamiento entre negocios, escalamiento, envío desde la bandeja, error 3011).
**No verificado**: una cuenta real de ManyChat (no la probamos; la cuenta revisada es plan gratis, sin API) ni el
tiempo máximo de espera del External Request.

**Email**: tarjeta visual «Próximamente» en Canales (sin funcionalidad todavía).

## Fase 4 publicada el 2026-11-22: dashboard configurable
Inicio → «Métricas», con periodo Hoy / 7 días / 30 días y «Personalizar» (cada persona elige qué tarjetas ver y en qué
orden; se guarda por persona y por negocio en `dashboard_prefs`). Tarjetas disponibles:
esperando a una persona (urgentes), resueltas por el asistente (%), conversaciones, pasadas a una persona, primera
respuesta humana (mediana), tiempo para resolver (mediana), preguntas que el asistente no supo responder (con «Agregar al
contexto»), mensajes por día, horas pico (zona horaria del negocio), mensajes por canal, motivos de paso a persona, qué
responde el asistente, tu equipo (respuestas y asignadas), clientes nuevos y recurrentes, fuera de horario, consultas de
pedidos y uso de IA con costo aproximado (solo administradores; precio de referencia Haiku 0.10 / 0.50 USD por millón
de tokens, en `dashboard/page.tsx`). Definiciones exactas: `src/lib/metrics/dashboard.ts`.

## Fase 2 publicada el 2026-11-23: avisos en el celular y la computadora
Menú → «Notificaciones» (todas las personas del equipo):
- **Activar avisos en este dispositivo** (Web Push), **Enviar prueba**, lista de dispositivos y **qué avisos** quiere
  cada persona en cada negocio: casos urgentes (seguridad / legal), «un cliente necesita a una persona», «me asignaron
  una conversación».
- **App instalable**: manifiesto e íconos (`public/icon-*.png`, `scripts/make-icons.mjs`). iPhone necesita instalarla
  («Compartir → Agregar a inicio», iOS 16.4+) para recibir avisos; Android y computadora funcionan desde el navegador.
- **Privacidad**: el push va VACÍO; el teléfono pide el texto a `/api/push/latest` con la sesión de la persona. El aviso
  nunca muestra el nombre ni los mensajes del cliente (solo tipo, canal y negocio). Solo se llama a los servicios de push
  de los navegadores (lista permitida). Las llaves VAPID se derivan de `APP_SECRET` (no hay variable nueva; si se rota
  `APP_SECRET`, cada persona vuelve a activar sus avisos).
- Avisos guardados 30 días (purga). Pendiente: avisos por correo (requiere Resend) y por WhatsApp/Telegram al encargado.
