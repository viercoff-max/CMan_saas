// Demo content (Spanish, Mexico). Pure data: no DB, no network. Everything here is FAKE.
import type { ContextSectionKey } from "../types";

export const DEMO_TENANT = "chefman";
/** Marks every demo row: conversations.external_id, sources.title and the audit_log actor. */
export const DEMO_PREFIX = "demo-";
export const DEMO_SOURCE_PREFIX = "[Demo] ";
export const DEMO_ACTOR = "demo";

export const DEMO_SECTIONS: Record<ContextSectionKey, string> = {
  business: `# Sobre Chefman
Chefman es una marca de pequeños electrodomésticos de cocina: freidoras de aire, licuadoras, hervidores eléctricos y arroceras. Vendemos en México a través de nuestra tienda en línea y enviamos a todo el país.

# Atención al cliente
Atendemos por WhatsApp, Instagram y Messenger de lunes a viernes de 9:00 a 18:00 (hora del centro de México). Fuera de ese horario una persona responde al abrir.

# Valores
Productos sencillos, seguros y fáciles de limpiar, con soporte en español y garantía clara.`,

  products: `# Freidora de aire AirCook 5L (modelo CF-AF50)
Capacidad de 5 litros, 1500 W, temperatura de 80 a 200 °C y canasta antiadherente apta para lavavajillas. Ideal para papas, alitas, verduras y empanadas.
Consejo de uso: precalienta 3 minutos, no sobrecargues la canasta y agita a la mitad de la cocción para que quede dorado parejo.

# Licuadora PowerBlend 1.5L (modelo CF-BL15)
Vaso de vidrio de 1.5 litros, motor de 1000 W y 5 velocidades con función pulso. Muele hielo, smoothies y salsas.
Consejo de uso: coloca primero los líquidos, luego lo suave y al final el hielo; nunca la llenes arriba de la marca máxima y no la uses con líquidos hirviendo.

# Hervidor eléctrico SpeedKettle 1.7L (modelo CF-KT17)
Acero inoxidable de 1.7 litros, 1800 W, apagado automático y protección contra funcionamiento en seco.
Consejo de uso: elimina el sarro cada mes hirviendo agua con vinagre blanco a partes iguales y enjuaga bien.

# Arrocera RiceMaster 1.8L (modelo CF-RC18)
Capacidad de 1.8 litros (hasta 10 tazas cocidas), olla antiadherente, función de mantener caliente y vaporera incluida.
Consejo de uso: lava el arroz antes de cocinarlo y usa la medida de agua marcada en la olla.

# Freidora de aire Dual 8L (modelo CF-AF80)
Dos canastas independientes de 4 litros cada una, 2200 W y función sincronizar para que ambas terminen al mismo tiempo.`,

  shipping_returns: `# Envíos
Enviamos a toda la República Mexicana con Estafeta y DHL. El tiempo de entrega es de 3 a 7 días hábiles después de que el pedido sale del almacén. Cuando el pedido se envía, el cliente recibe un número de guía para rastrearlo.

# Devoluciones y cambios
Aceptamos devoluciones dentro de los 30 días naturales posteriores a la entrega, con el producto en buen estado y en su empaque original. Los reembolsos, cancelaciones y cambios de dirección los gestiona una persona del equipo.`,

  warranty: `# Garantía
Todos los productos Chefman tienen 1 año de garantía contra defectos de fabricación, a partir de la fecha de compra.

# Cómo hacerla válida
Se necesita el número de pedido y una descripción o foto del problema. Una persona del equipo revisa el caso y confirma si procede reparación o reposición. La garantía no cubre golpes, mal uso ni desgaste normal.`,

  faq: `# Preguntas frecuentes
¿Puedo meter la canasta de la freidora al lavavajillas? Sí, la canasta antiadherente es apta para lavavajillas; la base y la resistencia no se sumergen.
¿Cómo consulto mi pedido? Con el número de pedido y el correo de la compra, el asistente muestra su estatus de envío.
¿Cuánto tarda mi pedido? De 3 a 7 días hábiles después de salir del almacén.
¿La licuadora muele hielo? Sí, la PowerBlend 1.5L muele hielo; usa la función pulso.`,

  escalation: `# Pasar con una persona
Pasa de inmediato con una persona del equipo cuando el cliente mencione humo, fuego, quemaduras, descargas eléctricas o cualquier lesión (caso urgente de seguridad), cuando mencione PROFECO, abogado o demanda, cuando pida hablar con una persona, o cuando pida reembolsos, cancelaciones o cambios de dirección. También cuando no haya información suficiente para responder con certeza o cuando el cliente envíe fotos o notas de voz.`,

  dos_donts: `# Lo que sí hacemos
Responder con amabilidad y en español de México, usando solo la información de este contexto. Ofrecer pasar con una persona cuando haga falta.

# Lo que nunca hacemos
No inventar promociones, descuentos, precios ni enlaces. No decir que un reembolso ya se hizo. No dar diagnósticos técnicos ni indicaciones de reparación. No pedir ni repetir datos personales, solo número de pedido y correo para consultar el estatus.`,

  extra: `# Cuidado general
Antes de limpiar cualquier aparato, desconéctalo y espera a que se enfríe. No sumerjas bases ni cables en agua.`,
};

export const DEMO_HOURS = { fromDay: 1, toDay: 5, open: "09:00", close: "18:00", timezone: "America/Mexico_City" };

export const DEMO_SETTINGS = {
  agentName: "Chef", toneLevel: 4 as const, greeting: "", fallbackMessage: "",
  crossSellLevel: 1 as const, handoffEmail: "demo@example.com",
};

export const DEMO_LINK_SOURCE = {
  title: `${DEMO_SOURCE_PREFIX}Manual de uso AirCook 5L (en línea)`,
  url: "https://example.com/manuales/aircook-5l",
  text: `Manual de uso rápido: Freidora de aire AirCook 5L (CF-AF50)

Primer uso: lava la canasta con agua tibia y jabón, sécala y haz funcionar la freidora vacía 5 minutos a 200 °C para eliminar el olor de fábrica.

Cocción: precalienta 3 minutos. Para papas a la francesa usa 200 °C durante 18 minutos y agita la canasta a la mitad. Para alitas de pollo usa 190 °C durante 22 minutos. No llenes la canasta más allá de la marca MAX.

Limpieza: desconecta y deja enfriar. La canasta es apta para lavavajillas. No sumerjas la base.

Solución de problemas: si sale humo blanco suele ser exceso de grasa; limpia la base. Si el aparato huele a quemado o sale humo negro, desconéctalo y contacta a soporte.`,
};

export const DEMO_FILE_SOURCE = {
  title: `${DEMO_SOURCE_PREFIX}Guía de garantía Chefman.pdf`,
  filePath: "demo/guia-garantia-chefman.pdf",
  text: `Guía de garantía Chefman

Cobertura: 1 año contra defectos de fabricación a partir de la fecha de compra, en todos los productos.
Para iniciar un reclamo: número de pedido, correo de compra y una descripción o foto del problema.
No cubre: golpes, caídas, uso con líquidos no indicados, ni desgaste normal de la canasta o del vaso.`,
};

// ---------- conversations ----------
export type DemoMsg = { from: "c" | "b" | "a"; text: string; mins?: number; meta?: Record<string, unknown> };
export interface DemoConv {
  key: string; channel: "whatsapp" | "instagram" | "messenger"; name: string;
  status: "resolved" | "needs_human" | "human"; reason?: string;
  /** minutes ago the conversation started */ startAgo: number;
  /** customer messages still unread */ unread: number;
  msgs: DemoMsg[];
}
