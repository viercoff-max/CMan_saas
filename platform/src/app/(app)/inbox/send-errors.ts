// Maps raw send errors (e.g. "Meta 400: ...") to a dictionary key. Raw detail is never shown to staff.
export type SendErrorKey = "e.window" | "e.notConnected" | "e.token" | "e.network" | "e.default";

export function classifySendError(detail: unknown): SendErrorKey {
  const d = String(detail ?? "");
  if (/channel_not_connected|missing_token|missing_phone_number_id/i.test(d)) return "e.notConnected";
  if (/timeout|network/i.test(d)) return "e.network";
  if (/131047|\b24\b|window|re-?engage|outside/i.test(d)) return "e.window";
  if (/\b190\b|\b401\b|\b463\b|\b467\b|token|oauth|expired|session/i.test(d)) return "e.token";
  return "e.default";
}
