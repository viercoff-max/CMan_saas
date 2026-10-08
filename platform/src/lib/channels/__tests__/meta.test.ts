import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { checkVerifyHandshake, parseMetaPayload, signaturePolicy, verifyMetaSignature } from "../meta";
import { splitMessage } from "../send";
import { buildHandoffText } from "../handoff";
import { isWindowExpired } from "../repo";

const sig = (body: string, secret: string) => "sha256=" + createHmac("sha256", secret).update(body).digest("hex");

describe("signature", () => {
  const body = JSON.stringify({ a: 1 });
  it("accepts a valid signature and rejects others", () => {
    expect(verifyMetaSignature(body, sig(body, "s3cret"), "s3cret")).toBe(true);
    expect(verifyMetaSignature(body, sig(body, "other"), "s3cret")).toBe(false);
    expect(verifyMetaSignature(body + " ", sig(body, "s3cret"), "s3cret")).toBe(false);
    expect(verifyMetaSignature(body, null, "s3cret")).toBe(false);
    expect(verifyMetaSignature(body, "abc", "s3cret")).toBe(false);
  });
  it("policy: secret configured requires a valid signature", () => {
    expect(signaturePolicy({ secret: "x", header: null, rawBody: body })).toEqual({ ok: false, reason: "missing_signature" });
    expect(signaturePolicy({ secret: "s3cret", header: "", rawBody: body }).ok).toBe(false);
    expect(signaturePolicy({ secret: "s3cret", header: sig(body, "s3cret"), rawBody: body }).ok).toBe(true);
    expect(signaturePolicy({ secret: "s3cret", header: sig(body, "other"), rawBody: body })).toEqual({ ok: false, reason: "bad_signature" });
    expect(signaturePolicy({ secret: "s3cret", header: sig(body + " ", "s3cret"), rawBody: body }).ok).toBe(false);
  });
  it("policy: FAIL CLOSED without a secret, in every environment", () => {
    expect(signaturePolicy({ rawBody: body })).toEqual({ ok: false, reason: "no_app_secret" });
    expect(signaturePolicy({ rawBody: body, header: sig(body, "x") }).ok).toBe(false);
    expect(signaturePolicy({ rawBody: body, allowUnsigned: "true" }).ok).toBe(false); // only the exact "1" opts in
    expect(signaturePolicy({ rawBody: body, allowUnsigned: "0" }).ok).toBe(false);
  });
  it("policy: ALLOW_UNSIGNED_WEBHOOKS=1 works only on a local PUBLIC_URL", () => {
    expect(signaturePolicy({ rawBody: body, allowUnsigned: "1" }).ok).toBe(true);
    expect(signaturePolicy({ rawBody: body, allowUnsigned: "1", publicUrl: "http://localhost:3000" }).ok).toBe(true);
    expect(signaturePolicy({ rawBody: body, allowUnsigned: "1", publicUrl: "https://abc.ngrok-free.app" }).ok).toBe(false);
    // a present-but-wrong signature is never accepted, even with the flag
    expect(signaturePolicy({ secret: "s3cret", rawBody: body, header: sig(body, "other"), allowUnsigned: "1" }).ok).toBe(false);
  });
});

describe("verify handshake", () => {
  const p = (o: Record<string, string>) => new URLSearchParams(o);
  it("echoes challenge when token matches", () => {
    expect(checkVerifyHandshake(p({ "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "123" }), "tok")).toBe("123");
  });
  it("rejects wrong token, wrong mode, missing config", () => {
    expect(checkVerifyHandshake(p({ "hub.mode": "subscribe", "hub.verify_token": "bad", "hub.challenge": "1" }), "tok")).toBeNull();
    expect(checkVerifyHandshake(p({ "hub.mode": "x", "hub.verify_token": "tok", "hub.challenge": "1" }), "tok")).toBeNull();
    expect(checkVerifyHandshake(p({ "hub.mode": "subscribe", "hub.verify_token": "tok", "hub.challenge": "1" }), undefined)).toBeNull();
  });
});

describe("parseMetaPayload", () => {
  it("parses WhatsApp text messages with contact name", () => {
    const out = parseMetaPayload({
      object: "whatsapp_business_account",
      entry: [{ id: "waba", changes: [{ field: "messages", value: {
        metadata: { phone_number_id: "555" },
        contacts: [{ wa_id: "5215512345678", profile: { name: "Ana" } }],
        messages: [
          { from: "5215512345678", id: "wamid.1", type: "text", text: { body: "Hola" } },
          { from: "5215512345678", id: "wamid.2", type: "image", image: { id: "x" } },
        ],
      } }] }],
    });
    expect(out).toEqual([
      { channel: "whatsapp", accountId: "555", externalId: "5215512345678", customerName: "Ana", text: "Hola", providerMessageId: "wamid.1" },
      { channel: "whatsapp", accountId: "555", externalId: "5215512345678", customerName: "Ana", text: "[Foto]", providerMessageId: "wamid.2", media: "image" },
    ]);
  });
  it("WhatsApp non-text messages become placeholders (never dropped); reactions are ignored", () => {
    const msg = (type: string, extra: Record<string, unknown> = {}) => ({ from: "521", id: `w-${type}`, type, ...extra });
    const out = parseMetaPayload({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "555" }, messages: [
        msg("image", { image: { id: "1", caption: "así quedó el enchufe" } }),
        msg("audio", { audio: { id: "2", voice: true } }),
        msg("sticker", { sticker: { id: "3" } }),
        msg("location", { location: { latitude: 1, longitude: 2 } }),
        msg("document", { document: { id: "4", filename: "ticket.pdf" } }),
        msg("video", { video: { id: "5" } }),
        msg("reaction", { reaction: { message_id: "x", emoji: "👍" } }),
        msg("interactive", { interactive: { type: "button_reply", button_reply: { id: "b", title: "Sí" } } }),
      ] } }] }],
    });
    expect(out.map((m) => [m.text, m.media])).toEqual([
      ["[Foto] así quedó el enchufe", "image"], ["[Nota de voz]", "audio"], ["[Sticker]", "sticker"],
      ["[Ubicación]", "location"], ["[Archivo]", "document"], ["[Video]", "video"], ["Sí", undefined],
    ]);
  });
  it("Messenger/Instagram attachments become placeholders", () => {
    const messaging = [
      { sender: { id: "u1" }, message: { mid: "a1", attachments: [{ type: "image", payload: { url: "https://x" } }] } },
      { sender: { id: "u1" }, message: { mid: "a2", attachments: [{ type: "audio", payload: { url: "https://x" } }] } },
      { sender: { id: "u1" }, message: { mid: "a3", sticker_id: 369239263222822, attachments: [{ type: "image", payload: { sticker_id: 369239263222822 } }] } },
      { sender: { id: "u1" }, message: { mid: "a4", attachments: [{ type: "location" }] } },
      { sender: { id: "u1" }, message: { mid: "a5", attachments: [{ type: "file" }] } },
      { sender: { id: "u1" }, message: { mid: "a6", is_unsupported: true } },
    ];
    const out = parseMetaPayload({ object: "instagram", entry: [{ id: "ig", messaging }] });
    expect(out.map((m) => [m.text, m.media])).toEqual([
      ["[Foto]", "image"], ["[Nota de voz]", "audio"], ["[Sticker]", "sticker"], ["[Ubicación]", "location"], ["[Archivo]", "document"], ["[Archivo]", "other"],
    ]);
  });
  it("ignores WhatsApp status updates", () => {
    expect(parseMetaPayload({ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages", value: { metadata: { phone_number_id: "1" }, statuses: [{ id: "x", status: "read" }] } }] }] })).toEqual([]);
  });
  it("parses Messenger and Instagram text and attachments; skips echoes, reads, deliveries", () => {
    const messaging = [
      { sender: { id: "u1" }, recipient: { id: "pg" }, message: { mid: "m1", text: "Hola" } },
      { sender: { id: "pg" }, recipient: { id: "u1" }, message: { mid: "m2", text: "eco", is_echo: true } },
      { sender: { id: "u1" }, recipient: { id: "pg" }, read: { watermark: 1 } },
      { sender: { id: "u1" }, recipient: { id: "pg" }, delivery: { mids: ["m"] } },
      { sender: { id: "u1" }, recipient: { id: "pg" }, message: { mid: "m3", attachments: [{ type: "image" }] } },
    ];
    const m = parseMetaPayload({ object: "page", entry: [{ id: "pg", messaging }] });
    expect(m).toEqual([
      { channel: "messenger", accountId: "pg", externalId: "u1", customerName: "", text: "Hola", providerMessageId: "m1" },
      { channel: "messenger", accountId: "pg", externalId: "u1", customerName: "", text: "[Foto]", providerMessageId: "m3", media: "image" },
    ]);
    const ig = parseMetaPayload({ object: "instagram", entry: [{ id: "ig", messaging }] });
    expect(ig).toHaveLength(2);
    expect(ig[0].channel).toBe("instagram");
  });
  it("ignores comments/feed changes and garbage", () => {
    expect(parseMetaPayload({ object: "page", entry: [{ id: "pg", changes: [{ field: "feed", value: { item: "comment", message: "hi" } }] }] })).toEqual([]);
    expect(parseMetaPayload(null)).toEqual([]);
    expect(parseMetaPayload("x")).toEqual([]);
    expect(parseMetaPayload({ object: "other", entry: [] })).toEqual([]);
  });
});

describe("splitMessage", () => {
  it("keeps short text whole and splits long text under the limit", () => {
    expect(splitMessage("hola")).toEqual(["hola"]);
    const long = Array.from({ length: 400 }, (_, i) => `palabra${i}`).join(" ");
    const parts = splitMessage(long, 1000);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= 1000)).toBe(true);
    expect(parts.join(" ")).toBe(long);
  });
  it("handles text without spaces", () => {
    expect(splitMessage("a".repeat(2500)).map((p) => p.length)).toEqual([1000, 1000, 500]);
  });
});

describe("handoff text", () => {
  const base = { to: "a@b.com", customerName: "Ana", channel: "whatsapp", link: "http://x/inbox?c=1", messages: [{ sender: "customer" as const, body: "se quema", createdAt: "t" }] };
  it("marks safety/legal as urgent", () => {
    expect(buildHandoffText({ ...base, reason: "safety" }).subject).toContain("URGENTE");
    expect(buildHandoffText({ ...base, reason: "legal" }).subject).toContain("URGENTE");
    expect(buildHandoffText({ ...base, reason: "no_answer" }).subject).not.toContain("URGENTE");
  });
  it("includes link and messages", () => {
    const t = buildHandoffText({ ...base, reason: "no_answer" }).text;
    expect(t).toContain("http://x/inbox?c=1");
    expect(t).toContain("se quema");
  });
  it("masks customer emails in the outbox text", () => {
    const t = buildHandoffText({ ...base, reason: "no_answer", messages: [{ sender: "customer", body: "pedido 1234 correo juan.perez@gmail.com", createdAt: "t" }] }).text;
    expect(t).not.toContain("juan.perez@gmail.com");
    expect(t).toContain("j***@gmail.com");
  });
});

describe("24h window", () => {
  const now = Date.parse("2026-01-02T12:00:00Z");
  it("expires after 24h on Meta channels only", () => {
    expect(isWindowExpired("whatsapp", "2026-01-01T11:00:00Z", now)).toBe(true);
    expect(isWindowExpired("instagram", "2026-01-02T00:00:00Z", now)).toBe(false);
    expect(isWindowExpired("messenger", null, now)).toBe(true);
    expect(isWindowExpired("simulator", "2020-01-01T00:00:00Z", now)).toBe(false);
  });
});
