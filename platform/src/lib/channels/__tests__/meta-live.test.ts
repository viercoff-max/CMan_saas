// Go-live fixes checked against the official Meta docs (2026-10): payload shapes, signature, limits, windows.
import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { escapeUnicode, parseMetaPayload, parseMetaStatusFailures, signaturePolicy, verifyMetaSignature } from "../meta";
import { describeGraphError, splitMessage, TEXT_LIMITS, windowDecision } from "../send";
import { FB_GRAPH, GRAPH_API_VERSION, IG_GRAPH, isInstagramLoginToken } from "../graph";

const mac = (s: string, secret: string) => "sha256=" + createHmac("sha256", secret).update(s, "utf8").digest("hex");

describe("graph constants", () => {
  it("pins one version for both hosts", () => {
    expect(GRAPH_API_VERSION).toMatch(/^v\d+\.0$/);
    expect(FB_GRAPH).toBe(`https://graph.facebook.com/${GRAPH_API_VERSION}`);
    expect(IG_GRAPH).toBe(`https://graph.instagram.com/${GRAPH_API_VERSION}`);
  });
  it("detects Instagram Login tokens by prefix", () => {
    expect(isInstagramLoginToken("IGAAxyz")).toBe(true);
    expect(isInstagramLoginToken("EAAGxyz")).toBe(false);
    expect(isInstagramLoginToken(undefined)).toBe(false);
  });
});

describe("X-Hub-Signature-256: escaped unicode (Meta docs: signature over \\u00e4-style escapes)", () => {
  const secret = "s3cret";
  const escapedBody = '{"text":"\\u00bfcu\\u00e1nto? \\ud83d\\ude00"}'; // what Meta normally sends
  const literalBody = '{"text":"¿cuánto? 😀"}';                           // same JSON with literal characters
  it("escapes non-ASCII as lowercase \\uXXXX (surrogate pairs too)", () => {
    expect(escapeUnicode(literalBody)).toBe(escapedBody);
    expect(escapeUnicode("äöå")).toBe("\\u00e4\\u00f6\\u00e5");
  });
  it("accepts the raw body and the literal-unicode body signed over its escaped form", () => {
    expect(verifyMetaSignature(escapedBody, mac(escapedBody, secret), secret)).toBe(true);
    expect(verifyMetaSignature(literalBody, mac(escapedBody, secret), secret)).toBe(true);
    expect(verifyMetaSignature(literalBody, mac(literalBody, secret), secret)).toBe(true);
    expect(verifyMetaSignature(literalBody, mac(escapedBody, "other"), secret)).toBe(false);
  });
  it("accepts uppercase hex in the header", () => {
    expect(verifyMetaSignature(escapedBody, mac(escapedBody, secret).toUpperCase().replace("SHA256=", "sha256="), secret)).toBe(true);
  });
  it("policy accepts any configured secret (Meta app secret or Instagram app secret), still fails closed", () => {
    const body = "{}";
    expect(signaturePolicy({ secret: ["meta", "ig"], header: mac(body, "ig"), rawBody: body }).ok).toBe(true);
    expect(signaturePolicy({ secret: ["meta", undefined], header: mac(body, "ig"), rawBody: body })).toEqual({ ok: false, reason: "bad_signature" });
    expect(signaturePolicy({ secret: [undefined, undefined], header: mac(body, "x"), rawBody: body })).toEqual({ ok: false, reason: "no_app_secret" });
    expect(signaturePolicy({ secret: [undefined, ""], rawBody: body })).toEqual({ ok: false, reason: "no_app_secret" });
  });
});

describe("Messenger / Instagram payloads", () => {
  it("postback (Get Started, ice breaker) becomes the button title", () => {
    const out = parseMetaPayload({ object: "page", entry: [{ id: "pg", messaging: [
      { sender: { id: "u1" }, recipient: { id: "pg" }, postback: { mid: "m-pb", title: "Estado de mi pedido", payload: "ORDER" } },
      { sender: { id: "u1" }, recipient: { id: "pg" }, postback: { payload: "GET_STARTED" } },
      { sender: { id: "u1" }, recipient: { id: "pg" }, reaction: { mid: "m1", action: "react", emoji: "❤" } },
    ] }] });
    expect(out.map((m) => [m.text, m.providerMessageId])).toEqual([["Estado de mi pedido", "m-pb"], ["GET_STARTED", undefined]]);
  });
  it("Instagram: entry.id routes, recipient.id is offered as an alternative id; echoes are skipped", () => {
    const out = parseMetaPayload({ object: "instagram", entry: [{ id: "PAGE1", messaging: [
      { sender: { id: "IGSID1" }, recipient: { id: "IGID1" }, message: { mid: "a", text: "hola" } },
      { sender: { id: "IGID1" }, recipient: { id: "IGSID1" }, message: { mid: "b", text: "eco", is_echo: true } },
    ] }] });
    expect(out).toEqual([{ channel: "instagram", accountId: "PAGE1", altAccountIds: ["IGID1"], externalId: "IGSID1", customerName: "", text: "hola", providerMessageId: "a" }]);
  });
  it("Instagram story mention, reel, ephemeral and quick replies", () => {
    const msg = (m: Record<string, unknown>) => ({ sender: { id: "u" }, recipient: { id: "ig" }, message: m });
    const out = parseMetaPayload({ object: "instagram", entry: [{ id: "ig", messaging: [
      msg({ mid: "1", attachments: [{ type: "story_mention", payload: { url: "https://x" } }] }),
      msg({ mid: "2", attachments: [{ type: "ig_reel", payload: { reel_video_id: "1" } }] }),
      msg({ mid: "3", attachments: [{ type: "ephemeral" }] }),
      msg({ mid: "4", text: "Sí", quick_reply: { payload: "YES" } }),
      msg({ mid: "5", text: "me encantó", reply_to: { story: { url: "https://x", id: "s" } } }),
      msg({ mid: "6", is_deleted: true }),
    ] }] });
    expect(out.map((m) => [m.text, m.media])).toEqual([
      ["[Publicación compartida]", "share"], ["[Publicación compartida]", "share"], ["[Archivo]", "other"], ["Sí", undefined], ["me encantó", undefined],
    ]);
  });
});

describe("WhatsApp payloads", () => {
  it("contacts, unsupported and button replies; order/system ignored", () => {
    const m = (type: string, extra: Record<string, unknown> = {}) => ({ from: "521", id: `w-${type}`, type, ...extra });
    const out = parseMetaPayload({ object: "whatsapp_business_account", entry: [{ id: "WABA", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp", metadata: { display_phone_number: "1555", phone_number_id: "PN" },
      messages: [
        m("contacts", { contacts: [{ name: { formatted_name: "Ana" } }] }),
        m("unsupported", { errors: [{ code: 131051 }] }),
        m("button", { button: { text: "Ver estado", payload: "X" } }),
        m("interactive", { interactive: { type: "list_reply", list_reply: { id: "l", title: "Garantía" } } }),
        m("order", { order: {} }), m("system", { system: {} }),
      ],
    } }] }] });
    expect(out.map((x) => [x.text, x.media])).toEqual([["[Contacto]", "contact"], ["[Archivo]", "other"], ["Ver estado", undefined], ["Garantía", undefined]]);
  });
  it("failed status webhooks are reported with the error code and no phone number", () => {
    const body = { object: "whatsapp_business_account", entry: [{ id: "WABA", changes: [{ field: "messages", value: {
      metadata: { phone_number_id: "PN" },
      statuses: [
        { id: "wamid.1", status: "failed", recipient_id: "5215555", errors: [{ code: 131047, title: "Re-engagement message", error_data: { details: "x" } }] },
        { id: "wamid.2", status: "delivered", recipient_id: "5215555" },
      ],
    } }] }] };
    const f = parseMetaStatusFailures(body);
    expect(f).toEqual([{ channel: "whatsapp", accountId: "PN", providerMessageId: "wamid.1", code: 131047, title: "Re-engagement message" }]);
    expect(JSON.stringify(f)).not.toContain("5215555");
    expect(parseMetaPayload(body)).toEqual([]);
    expect(parseMetaStatusFailures({ object: "page", entry: [] })).toEqual([]);
  });
});

describe("text limits and splitting", () => {
  it("documented limits", () => {
    expect(TEXT_LIMITS).toEqual({ whatsapp: { max: 4096, unit: "chars" }, messenger: { max: 1999, unit: "chars" }, instagram: { max: 1000, unit: "bytes" } });
  });
  it("Instagram splits by UTF-8 bytes (accents are 2 bytes, emoji 4) and never breaks an emoji", () => {
    const text = Array.from({ length: 300 }, (_, i) => `canción${i} 😀`).join(" ");
    const parts = splitMessage(text, 1000, "bytes");
    expect(parts.length).toBeGreaterThan(1);
    for (const p of parts) {
      expect(Buffer.byteLength(p, "utf8")).toBeLessThanOrEqual(1000);
      expect(p).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/);
    }
    expect(parts.join(" ")).toBe(text);
    const noSpaces = "é".repeat(1200); // 2400 bytes
    expect(splitMessage(noSpaces, 1000, "bytes").map((p) => Buffer.byteLength(p))).toEqual([1000, 1000, 400]);
  });
});

describe("messaging windows", () => {
  const now = Date.parse("2026-10-06T12:00:00Z");
  const ago = (h: number) => new Date(now - h * 3600_000).toISOString();
  it("inside 24 h: plain RESPONSE everywhere", () => {
    for (const ch of ["whatsapp", "messenger", "instagram"] as const) expect(windowDecision(ch, ago(23), now)).toEqual({ ok: true, humanAgentTag: false });
  });
  it("WhatsApp after 24 h needs a template: refused before calling Meta", () => {
    expect(windowDecision("whatsapp", ago(25), now, true)).toEqual({ ok: false, error: "outside_24h_window_template_required" });
  });
  it("Messenger/Instagram after 24 h: HUMAN_AGENT tag up to 7 days only when enabled", () => {
    expect(windowDecision("messenger", ago(48), now)).toEqual({ ok: false, error: "outside_24h_window" });
    expect(windowDecision("instagram", ago(48), now, true)).toEqual({ ok: true, humanAgentTag: true });
    expect(windowDecision("messenger", ago(24 * 8), now, true)).toEqual({ ok: false, error: "outside_7d_human_agent_window" });
  });
  it("unknown last inbound is left to Meta", () => {
    expect(windowDecision("whatsapp", null, now)).toEqual({ ok: true, humanAgentTag: false });
  });
});

describe("Graph send errors", () => {
  it("names the common go-live failures", () => {
    expect(describeGraphError(400, { error: { code: 131047, message: "Re-engagement message" } })).toMatch(/^outside_24h_window_template_required \(http 400 code 131047\)/);
    expect(describeGraphError(400, { error: { code: 131030 } })).toMatch(/^recipient_not_in_test_allowed_list/);
    expect(describeGraphError(401, { error: { code: 190, message: "Error validating access token" } })).toMatch(/^token_expired_or_invalid/);
    expect(describeGraphError(400, { error: { code: 10, error_subcode: 2018278 } })).toMatch(/^outside_messaging_window \(http 400 code 10\/2018278\)/);
    expect(describeGraphError(500, null)).toBe("meta_error (http 500)");
  });
});
