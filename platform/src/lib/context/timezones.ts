// Friendly timezone choices (IANA value + plain-language label).
export interface TzOption { value: string; es: string; en: string }
export const TIMEZONES: TzOption[] = [
  { value: "America/Mexico_City", es: "Ciudad de México, Guadalajara, Puebla (centro)", en: "Mexico City, Guadalajara, Puebla (Central)" },
  { value: "America/Monterrey", es: "Monterrey (centro)", en: "Monterrey (Central)" },
  { value: "America/Merida", es: "Mérida (centro)", en: "Mérida (Central)" },
  { value: "America/Cancun", es: "Cancún, Quintana Roo (sureste)", en: "Cancún, Quintana Roo (Southeast)" },
  { value: "America/Chihuahua", es: "Chihuahua (centro)", en: "Chihuahua (Central)" },
  { value: "America/Mazatlan", es: "Mazatlán, La Paz, Culiacán (pacífico)", en: "Mazatlán, La Paz, Culiacán (Pacific)" },
  { value: "America/Hermosillo", es: "Hermosillo, Sonora (sin horario de verano)", en: "Hermosillo, Sonora (no daylight saving)" },
  { value: "America/Tijuana", es: "Tijuana, Mexicali (noroeste)", en: "Tijuana, Mexicali (Northwest)" },
  { value: "America/Bogota", es: "Bogotá, Colombia", en: "Bogotá, Colombia" },
  { value: "America/Lima", es: "Lima, Perú", en: "Lima, Peru" },
  { value: "America/Santiago", es: "Santiago, Chile", en: "Santiago, Chile" },
  { value: "America/Argentina/Buenos_Aires", es: "Buenos Aires, Argentina", en: "Buenos Aires, Argentina" },
  { value: "America/New_York", es: "Nueva York, Miami (este de EE. UU.)", en: "New York, Miami (US Eastern)" },
  { value: "America/Chicago", es: "Chicago, Dallas (centro de EE. UU.)", en: "Chicago, Dallas (US Central)" },
  { value: "America/Los_Angeles", es: "Los Ángeles (pacífico de EE. UU.)", en: "Los Angeles (US Pacific)" },
  { value: "Europe/Madrid", es: "Madrid, España", en: "Madrid, Spain" },
  { value: "UTC", es: "Hora universal (UTC)", en: "Universal time (UTC)" },
];
/** Options for a select, keeping an unknown saved zone visible instead of silently changing it. */
export function tzOptions(current: string, locale: "es" | "en"): { value: string; label: string }[] {
  const list = TIMEZONES.map((z) => ({ value: z.value, label: z[locale] }));
  return list.some((o) => o.value === current) ? list : [{ value: current, label: current }, ...list];
}
