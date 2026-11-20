// Pure Telegram helpers (Bot API 10.4, core.telegram.org/bots/api, checked 2026-11-19). fetch is always injected/mocked.
import { describe, expect, it, vi } from "vitest";
import {
  botIdFromToken, classifyTelegramError, isTelegramBotToken, maskTelegramToken, parseTelegramUpdate, TELEGRAM_API,
  telegramCall, telegramDeleteWebhook, telegramGetMe, telegramSetWebhook, telegramWebhookReachable, telegramWebhookUrl,
} from "../telegram";

const TOKEN = "123456789:AAHfakeFAKEfake_fake-0123456789abcdefXY";
const resp = (status: number, body: unknown) => Promise.resolve(new Response(JSON.stringify(body), { status }));
const asFetch = (fn: unknown) => fn as unknown as typeof fetch;

describe("bot token format", () => {
  it("accepts BotFather tokens and extracts the bot id", () => {
    expect(isTelegramBotToken(TOKEN)).toBe(true);
    expect(botIdFromToken(TOKEN)).toBe("123456789");
  });
  it("rejects anything else", () => {
    for (const t of ["", "123456789", "abc:AAHfakeFAKEfake_fake-0123456789abcdef", "123456789:short", `123456789:${"a".repeat(40)} `, "1234:AAHfakeFAKEfake_fake-0123456789abcdef", `123456789:${"a".repeat(30)}/x`, null, 42]) {
      expect(isTelegramBotToken(t)).toBe(false);
    }
  });
  it("masks the token for the UI", () => {
    expect(maskTelegramToken(TOKEN)).toBe("1234••••••••XY");
    expect(maskTelegramToken(TOKEN)).not.toContain("AAHfake");
  });
});

describe("webhook URL", () => {
  it("only public HTTPS on ports 443/80/88/8443 is reachable", () => {
    expect(telegramWebhookReachable("https://app.example.com")).toBe(true);
    expect(telegramWebhookReachable("https://app.example.com:8443")).toBe(true);
    expect(telegramWebhookReachable("https://app.example.com:3000")).toBe(false);
    expect(telegramWebhookReachable("http://app.example.com")).toBe(false);
    expect(telegramWebhookReachable("https://localhost")).toBe(false);
    expect(telegramWebhookReachable("http://localhost:3000")).toBe(false);
    expect(telegramWebhookReachable(undefined)).toBe(false);
    expect(telegramWebhookReachable("not a url")).toBe(false);
  });
  it("builds the per-bot URL", () => {
    expect(telegramWebhookUrl("https://x.test/", "abc-123")).toBe("https://x.test/api/webhooks/telegram/abc-123");
  });
});

describe("API calls (mocked fetch)", () => {
  it("getMe returns the bot id and username", async () => {
    const f = vi.fn(() => resp(200, { ok: true, result: { id: 123456789, is_bot: true, first_name: "Chefman", username: "ChefmanAyudaBot" } }));
    expect(await telegramGetMe(TOKEN, asFetch(f))).toEqual({ ok: true, result: { id: "123456789", username: "ChefmanAyudaBot", firstName: "Chefman" } });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${TELEGRAM_API}/bot${TOKEN}/getMe`);
    expect(init.method).toBe("POST");
  });
  it("getMe maps 401 to token, network errors to network, non-bot to token", async () => {
    expect(await telegramGetMe(TOKEN, asFetch(vi.fn(() => resp(401, { ok: false, error_code: 401, description: "Unauthorized" }))))).toEqual({ ok: false, error: "token", status: 401 });
    expect(await telegramGetMe(TOKEN, asFetch(vi.fn(() => Promise.reject(new Error("down")))))).toEqual({ ok: false, error: "network" });
    expect(await telegramGetMe(TOKEN, asFetch(vi.fn(() => resp(200, { ok: true, result: { id: 1, is_bot: false } }))))).toEqual({ ok: false, error: "token" });
  });
  it("setWebhook sends url, secret_token, allowed_updates and drop_pending_updates", async () => {
    const f = vi.fn(() => resp(200, { ok: true, result: true }));
    expect(await telegramSetWebhook(TOKEN, { url: "https://x.test/api/webhooks/telegram/w1", secretToken: "s3cr3t_-" }, asFetch(f))).toEqual({ ok: true, result: true });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${TELEGRAM_API}/bot${TOKEN}/setWebhook`);
    expect(JSON.parse(String(init.body))).toEqual({
      url: "https://x.test/api/webhooks/telegram/w1", secret_token: "s3cr3t_-", allowed_updates: ["message", "edited_message"], drop_pending_updates: true,
    });
  });
  it("deleteWebhook drops pending updates", async () => {
    const f = vi.fn(() => resp(200, { ok: true, result: true }));
    await telegramDeleteWebhook(TOKEN, asFetch(f));
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${TELEGRAM_API}/bot${TOKEN}/deleteWebhook`);
    expect(JSON.parse(String(init.body))).toEqual({ drop_pending_updates: true });
  });
  it("reads retry_after on 429 and never puts the token in the result", async () => {
    const r = await telegramCall(TOKEN, "sendMessage", {}, asFetch(vi.fn(() => resp(429, { ok: false, error_code: 429, description: "Too Many Requests: retry after 7", parameters: { retry_after: 7 } }))));
    expect(r).toEqual({ ok: false, error: "rate", status: 429, retryAfter: 7 });
    expect(JSON.stringify(r)).not.toContain(TOKEN);
  });
  it("classifies errors", () => {
    expect(classifyTelegramError(401, "Unauthorized")).toBe("token");
    expect(classifyTelegramError(404, "Not Found")).toBe("token");
    expect(classifyTelegramError(403, "Forbidden: bot was blocked by the user")).toBe("blocked");
    expect(classifyTelegramError(400, "Bad Request: chat not found")).toBe("chat_not_found");
    expect(classifyTelegramError(400, "Bad Request: message text is empty")).toBe("bad_request");
    expect(classifyTelegramError(500, "")).toBe("unknown");
  });
});

const priv = (message: Record<string, unknown>) => ({
  update_id: 1,
  message: { message_id: 55, date: 1, chat: { id: 9001, type: "private", first_name: "Ana" }, from: { id: 9001, is_bot: false, first_name: "Ana", last_name: "López", username: "anal" }, ...message },
});

describe("parseTelegramUpdate", () => {
  it("text message from a private chat", () => {
    expect(parseTelegramUpdate(priv({ text: "¿Tienen envíos?" }))).toEqual({
      ok: true, item: { externalId: "9001", customerName: "Ana López", text: "¿Tienen envíos?", providerMessageId: "9001:55" },
    });
  });
  it("/start (with or without payload / @bot) becomes a greeting", () => {
    for (const t of ["/start", "/start promo42", "/start@ChefmanAyudaBot"]) {
      expect(parseTelegramUpdate(priv({ text: t }))).toMatchObject({ ok: true, item: { text: "Hola" } });
    }
    expect(parseTelegramUpdate(priv({ text: "/starter" }))).toMatchObject({ ok: true, item: { text: "/starter" } });
  });
  it("media become the engine placeholders (caption kept)", () => {
    const cases: [Record<string, unknown>, string, string][] = [
      [{ photo: [{ file_id: "a" }], caption: "se rompió" }, "image", "[Foto] se rompió"],
      [{ voice: { file_id: "v" } }, "audio", "[Nota de voz]"],
      [{ audio: { file_id: "v" } }, "audio", "[Nota de voz]"],
      [{ video: { file_id: "v" } }, "video", "[Video]"],
      [{ video_note: { file_id: "v" } }, "video", "[Video]"],
      [{ animation: { file_id: "g" }, document: { file_id: "g" } }, "video", "[Video]"],
      [{ document: { file_id: "d" }, caption: "ticket" }, "document", "[Archivo] ticket"],
      [{ sticker: { file_id: "s" } }, "sticker", "[Sticker]"],
      [{ location: { latitude: 1, longitude: 2 } }, "location", "[Ubicación]"],
      [{ contact: { phone_number: "1", first_name: "x" } }, "contact", "[Contacto]"],
      [{ dice: { emoji: "🎲", value: 3 } }, "other", "[Archivo]"],
    ];
    for (const [msg, kind, text] of cases) expect(parseTelegramUpdate(priv(msg))).toMatchObject({ ok: true, item: { media: kind, text } });
  });
  it("name falls back to the username", () => {
    const u = { update_id: 2, message: { message_id: 1, chat: { id: 5, type: "private" }, from: { id: 5, is_bot: false, username: "solo_user" }, text: "hola" } };
    expect(parseTelegramUpdate(u)).toMatchObject({ ok: true, item: { customerName: "solo_user" } });
  });
  it("ignores groups, channels, bots, edits and service messages", () => {
    const group = { update_id: 3, message: { message_id: 1, chat: { id: -100, type: "group" }, from: { id: 5, is_bot: false }, text: "hola" } };
    const supergroup = { update_id: 3, message: { message_id: 1, chat: { id: -100, type: "supergroup" }, from: { id: 5, is_bot: false }, text: "hola" } };
    expect(parseTelegramUpdate(group)).toEqual({ ok: false, skip: "not_private" });
    expect(parseTelegramUpdate(supergroup)).toEqual({ ok: false, skip: "not_private" });
    expect(parseTelegramUpdate({ update_id: 4, channel_post: { message_id: 1, chat: { id: -1, type: "channel" }, text: "x" } })).toEqual({ ok: false, skip: "not_message" });
    expect(parseTelegramUpdate(priv({ from: { id: 7, is_bot: true, first_name: "OtherBot" }, text: "hola" }))).toEqual({ ok: false, skip: "from_bot" });
    expect(parseTelegramUpdate({ update_id: 5, edited_message: priv({ text: "editado" }).message })).toEqual({ ok: false, skip: "edited" });
    expect(parseTelegramUpdate(priv({ new_chat_title: "x" }))).toEqual({ ok: false, skip: "empty" });
    expect(parseTelegramUpdate(priv({ from: undefined, text: "x" }))).toEqual({ ok: false, skip: "no_sender" });
    expect(parseTelegramUpdate(null)).toEqual({ ok: false, skip: "not_message" });
  });
});
