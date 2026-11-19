# Plan: SaaS MVP (multi-cliente, para vender)

Fecha: 2026-11-19. Reemplaza el enfoque "solo Chefman". Objetivo: un MVP vendible que cualquier negocio pueda
probar, y migrar después a WhatsApp y a producción completa.

## Decisiones tomadas
| Tema | Decisión MVP | Después |
|---|---|---|
| Producto | SaaS general, multi-cliente. Se quita todo lo específico de Chefman. | Igual |
| Base de datos | Supabase (Postgres + Auth + Storage), plan gratis | Plan de pago, respaldos con restauración |
| Canal | **Telegram** (bot propio de cada cliente, sin revisión de Meta) + simulador | WhatsApp (Tech Provider + Registro integrado), Instagram, Messenger |
| IA | Claude Haiku (`claude-haiku-4-5`) vía API de Anthropic | Igual, con topes por plan |
| Hosting | Vercel | Vercel Pro |
| Cobros | No en el MVP (o Stripe en modo prueba) | Stripe + CFDI |
| Shopify | Complemento opcional (ya construido) | Más complementos |

## Qué se reutiliza tal cual
Motor del asistente (escalamiento, flujo de pedidos, protecciones, plantillas de tono), pantallas de Contexto, Tono,
Fuentes, Bandeja y Complementos, conector de Shopify, retención/borrado, pruebas.

## Fases
**Fase 0. Requisitos previos** (ver lista abajo). Responsable: dueño.

**Fase 1. Supabase y multi-cliente** (la base de todo)
- Pasar de SQLite a Postgres: esquema, migraciones, RLS por cliente en cada tabla, prueba negativa entre clientes.
- Login con Supabase Auth: registro, verificar correo, recuperar contraseña, invitar usuarios (roles admin / agente).
- Archivos subidos a Supabase Storage (carpeta por cliente).
- Asistente de alta para un cliente nuevo: nombre del negocio, tono, contexto, conectar canal, probar.
- Quitar "Chefman" del código, textos y datos demo. Demo genérica para presentaciones.

**Fase 2. Canal Telegram**
- Conector de Telegram: el cliente crea su bot con @BotFather y pega el token en "Canales"; la app registra el
  webhook con un token secreto propio y verifica ese encabezado en cada mensaje (falla cerrado).
- Recibir texto y adjuntos, contestar, derivar a persona y responder desde la Bandeja.
- WhatsApp, Instagram y Messenger quedan como "Próximamente" (el código existe y no se borra).

**Fase 3. IA con Haiku**
- Cambiar `src/lib/engine/llm.ts` de OpenAI a Anthropic. Mismas protecciones y validador.
- Medir tokens y conversaciones por cliente; tope mensual por cliente para que el costo no se dispare.

**Fase 4. Despliegue**
- Vercel conectado al repo de GitHub; variables secretas solo en Vercel.
- Ambiente de pruebas (preview) y producción separados.
- Correo con Resend para avisos de derivación y correos de Supabase Auth.
- Monitoreo de errores sin datos personales.

**Fase 5. Listo para vender**
- Página de presentación, página de precios (sin cobro real o Stripe de prueba), términos y aviso de privacidad básicos.
- Cuenta demo para presentaciones.

**Después del MVP:** WhatsApp (verificar empresa en Meta, Tech Provider, Registro integrado, plantillas para
mensajes después de 24 h, costo por mensaje), cobros con Stripe y CFDI, acuerdo de datos por cliente, Realtime en la
Bandeja, colas para mensajes, revisión de seguridad externa.

## Requisitos previos (dueño)
1. **Supabase** (gratis): crear organización y un proyecto. Elegir región (la más cercana a tus clientes).
   Guardar la contraseña de la base de datos en un gestor de contraseñas.
2. **Anthropic**: cuenta en console.anthropic.com, método de pago o créditos, una API key para el MVP y un límite
   de gasto mensual.
3. **Telegram**: una cuenta de Telegram y un bot de prueba creado con @BotFather.
4. **Vercel**: cuenta conectada a GitHub. El plan Hobby (gratis) es para uso no comercial: para vender, plan Pro
   (verificar condiciones vigentes).
5. **Resend** (gratis): cuenta para enviar correos. Con un dominio propio se configura SPF/DKIM.
6. **Dominio** (opcional en el MVP): sirve para correos que no caigan en spam y una dirección profesional.
7. **Nombre del producto**: el repo se llama `CMan_saas`; decidir el nombre comercial.
8. **Decisión de costos**: en el MVP tú pagas la IA con tope por cliente; Telegram no cobra por mensaje.

Las claves secretas NO se pegan en el chat: van en `platform/.env.local` (local) y en las variables de Vercel.

## Por verificar al implementar
Límites del plan gratis de Supabase (tamaño, pausa por inactividad), condiciones comerciales de Vercel Hobby,
detalles actuales de la API de Telegram (encabezado del token secreto del webhook, puertos permitidos), precio
vigente de Haiku.
