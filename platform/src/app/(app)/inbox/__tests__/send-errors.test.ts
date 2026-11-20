import { describe, expect, it } from "vitest";
import { classifySendError, sendFailureStatus } from "../send-errors";
import { inboxDict } from "../dict";
import { describeTelegramError } from "@/lib/channels/send";

describe("classifySendError", () => {
  it("maps known failures to friendly keys", () => {
    expect(classifySendError("Meta 400: (#131047) Re-engagement message")).toBe("e.window");
    expect(classifySendError("channel_not_connected")).toBe("e.notConnected");
    expect(classifySendError("missing_token")).toBe("e.notConnected");
    expect(classifySendError("Meta 401: Invalid OAuth access token")).toBe("e.token");
    expect(classifySendError("timeout")).toBe("e.network");
    expect(classifySendError("network_error")).toBe("e.network");
  });
  it("maps the Telegram failures the sender reports (blocked, rate limit, chat gone, token)", () => {
    expect(classifySendError(describeTelegramError("blocked", 403))).toBe("e.blocked");
    expect(classifySendError(describeTelegramError("rate", 429, 30))).toBe("e.rate");
    expect(classifySendError(describeTelegramError("chat_not_found", 400))).toBe("e.chatNotFound");
    expect(classifySendError(describeTelegramError("token", 401))).toBe("e.token");
    expect(inboxDict.es["e.blocked"]).toBe("El cliente bloqueó el bot; no podemos enviarle mensajes.");
    for (const k of ["e.blocked", "e.rate", "e.chatNotFound", "e.token"]) expect(inboxDict.en[k], k).toBeTruthy();
  });
  it("falls back to a generic message", () => {
    expect(classifySendError("Meta 500: boom")).toBe("e.default");
    expect(classifySendError(undefined)).toBe("e.default");
  });
});

describe("sendFailureStatus (reply route)", () => {
  it("not connected -> 409, window / blocked -> 422, throttled -> 429, other upstream -> 502", () => {
    expect(sendFailureStatus("channel_not_connected")).toBe(409);
    expect(sendFailureStatus("missing_token")).toBe(409);
    expect(sendFailureStatus("outside_24h_window_template_required (http 400 code 131047)")).toBe(422);
    expect(sendFailureStatus("outside_24h_window")).toBe(422);
    expect(sendFailureStatus("rate_limited retry_after=30s (http 429)")).toBe(429);
    expect(sendFailureStatus("telegram_bot_blocked_by_user (http 403)")).toBe(422);
    expect(sendFailureStatus("network_error")).toBe(502);
  });
});
