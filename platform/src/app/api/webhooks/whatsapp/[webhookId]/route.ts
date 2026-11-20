// WhatsApp webhook for businesses that use THEIR OWN Meta app: /api/webhooks/whatsapp/<webhookId>.
// GET = Meta's handshake (hub.verify_token must equal the tenant's verify token). POST = messages, accepted only when
// X-Hub-Signature-256 over the RAW body verifies with that tenant's App Secret (timing-safe). Only messages addressed
// to the tenant's own phone_number_id are processed, so a payload can never land in another tenant.
// Answers 200 fast (Meta retries non-2xx), then runs the engine and the reply with after().
// Never logs secrets, tokens, header values, message text or phone numbers.
import { after } from "next/server";
import { parseMetaPayload, parseMetaStatusFailures, verifyMetaSignature, type MetaInbound } from "@/lib/channels/meta";
import { resolveOwnAppWebhook, tokenMatches } from "@/lib/channels/whatsapp-own";
import { handleInbound } from "@/lib/engine";
import { getData } from "@/lib/data";
import { sendToCustomer } from "@/lib/channels/send";

export const dynamic = "force-dynamic";

const WEBHOOK_ID_SHAPE = /^[A-Za-z0-9-]{8,64}$/;
// WhatsApp docs: payloads up to 3 MB (same cap as the platform Meta route).
const MAX_BODY_BYTES = 3_500_000;
const forbidden = () => new Response("forbidden", { status: 403 });

export async function GET(req: Request, ctx: { params: Promise<{ webhookId: string }> }) {
  const { webhookId } = await ctx.params;
  if (!WEBHOOK_ID_SHAPE.test(webhookId ?? "")) return forbidden();
  const q = new URL(req.url).searchParams;
  const challenge = q.get("hub.challenge");
  if (q.get("hub.mode") !== "subscribe" || challenge === null || challenge.length > 200) return forbidden();
  const route = await resolveOwnAppWebhook(webhookId);
  if (!route || !tokenMatches(route.secrets.verifyToken, q.get("hub.verify_token"))) return forbidden();
  // Show "webhook verificado" in /channels.
  const data = getData();
  const a = await data.channels.get(route.tenantId, "whatsapp");
  if (a.status === "connected" && a.publicInfo.webhook !== "ok") {
    await data.channels.save(route.tenantId, "whatsapp", { status: "connected", publicInfo: { ...a.publicInfo, webhook: "ok" } });
  }
  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

async function processOne(tenantId: string, item: MetaInbound) {
  const reply = await handleInbound({
    tenantId, channel: "whatsapp", externalId: item.externalId, customerName: item.customerName || undefined,
    text: item.text, providerMessageId: item.providerMessageId, media: item.media,
  });
  if (!reply.text) return; // duplicate, a person has the conversation, or the bot is off
  const conv = await getData().conversations.getOrCreate(tenantId, "whatsapp", item.externalId, item.customerName);
  const sent = await sendToCustomer(tenantId, conv, reply.text);
  if (!sent.ok) console.error(`[whatsapp webhook] reply not delivered error=${sent.error}`);
}

export async function POST(req: Request, ctx: { params: Promise<{ webhookId: string }> }) {
  const { webhookId } = await ctx.params;
  if (!WEBHOOK_ID_SHAPE.test(webhookId ?? "")) return forbidden();
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return new Response("payload too large", { status: 413 });
  const route = await resolveOwnAppWebhook(webhookId);
  if (!route) return forbidden();

  const raw = await req.text(); // RAW body: the signature is computed over these exact bytes
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return new Response("payload too large", { status: 413 });
  if (!verifyMetaSignature(raw, req.headers.get("x-hub-signature-256"), route.secrets.appSecret)) {
    console.warn("[whatsapp webhook] rejected: bad_signature");
    return forbidden();
  }

  let items: MetaInbound[] = [];
  try {
    const body = JSON.parse(raw);
    // Only this tenant's own number: a signed payload for another phone_number_id is ignored.
    items = parseMetaPayload(body).filter((i) => i.channel === "whatsapp" && i.accountId === route.secrets.phoneNumberId);
    for (const f of parseMetaStatusFailures(body)) {
      if (f.accountId === route.secrets.phoneNumberId) console.warn(`[whatsapp webhook] delivery failed code=${f.code} title=${f.title}`);
    }
  } catch { return new Response("bad request", { status: 400 }); }

  if (items.length > 0) {
    const { tenantId } = route;
    after(async () => {
      for (const item of items) {
        try { await processOne(tenantId, item); } catch { console.error("[whatsapp webhook] processing failed"); }
      }
    });
  }
  return new Response("ok", { status: 200 });
}
