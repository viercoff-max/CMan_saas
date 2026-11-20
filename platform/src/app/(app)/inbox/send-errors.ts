// Maps raw send errors (e.g. "Meta 400: ...", "telegram_bot_blocked_by_user (http 403)") to a dictionary key and an
// HTTP status. Raw detail is never shown to staff.
export type SendErrorKey = "e.window" | "e.notConnected" | "e.token" | "e.network" | "e.blocked" | "e.chatNotFound" | "e.rate" | "e.default";

export function classifySendError(detail: unknown): SendErrorKey {
  const d = String(detail ?? "");
  if (/telegram_bot_blocked_by_user/i.test(d)) return "e.blocked";
  if (/telegram_chat_not_found|recipient_unavailable|undeliverable/i.test(d)) return "e.chatNotFound";
  if (/rate_limited/i.test(d)) return "e.rate";
  if (/channel_not_connected|missing_token|missing_phone_number_id/i.test(d)) return "e.notConnected";
  if (/timeout|network/i.test(d)) return "e.network";
  if (/131047|\b24\b|window|re-?engage|outside/i.test(d)) return "e.window";
  if (/\b190\b|\b401\b|\b463\b|\b467\b|token|oauth|expired|session/i.test(d)) return "e.token";
  return "e.default";
}

/**
 * HTTP status of the reply route for a failed send (REVIEW-qa-2 P1-2 / P2-11): a channel that is not connected is a
 * state the staff can fix (409), a closed messaging window or a customer who blocked the bot / deleted the chat is a
 * refusal (422), throttling is 429, anything else is an upstream failure (502).
 */
export function sendFailureStatus(detail: string): number {
  if (/channel_not_connected|missing_token|missing_phone_number_id|unknown_channel/i.test(detail)) return 409;
  if (/outside_\w*window|outside_messaging_window|blocked_by_user|chat_not_found/i.test(detail)) return 422;
  if (/rate_limited/i.test(detail)) return 429;
  return 502;
}
