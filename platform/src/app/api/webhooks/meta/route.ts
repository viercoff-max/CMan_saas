import { after } from "next/server";
import { checkVerifyHandshake, parseMetaPayload, parseMetaStatusFailures, signaturePolicy, type MetaInbound } from "@/lib/channels/meta";
import { getOrCreateConversation } from "@/lib/store";
import { routeTenant } from "@/lib/channels/routing";
import { handleInbound } from "@/lib/engine";
import { sendToCustomer } from "@/lib/channels/send";

export const dynamic = "force-dynamic";

/** Meta webhook verification handshake. */
export async function GET(req: Request) {
  const challenge = checkVerifyHandshake(new URL(req.url).searchParams, process.env.META_VERIFY_TOKEN);
  if (challenge === null) return new Response("forbidden", { status: 403 });
  return new Response(challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

async function processOne(item: MetaInbound) {
  const tenantId = routeTenant(item);
  if (!tenantId) return; // unknown account: ignore
  const reply = await handleInbound({
    tenantId, channel: item.channel, externalId: item.externalId, customerName: item.customerName || undefined,
    text: item.text, providerMessageId: item.providerMessageId, media: item.media,
  });
  if (!reply.text) return; // human has the conversation, or bot disabled
  const conv = getOrCreateConversation(tenantId, item.channel, item.externalId, item.customerName);
  const sent = await sendToCustomer(tenantId, conv, reply.text);
  if (!sent.ok) console.error(`[meta webhook] reply not delivered channel=${item.channel} error=${sent.error}`);
}

// WhatsApp docs: "Webhook payloads can be up to 3 MB". Rejecting a valid payload makes Meta retry for days and can get
// the app unsubscribed, so the cap sits above that.
const MAX_BODY_BYTES = 3_500_000;

export async function POST(req: Request) {
  // Size cap first (Meta payloads are small); then fail-closed signature check over the raw body.
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return new Response("payload too large", { status: 413 });
  const raw = await req.text(); // RAW body: the signature is computed over these exact bytes
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return new Response("payload too large", { status: 413 });
  const policy = signaturePolicy({
    secret: [process.env.META_APP_SECRET, process.env.META_IG_APP_SECRET],
    header: req.headers.get("x-hub-signature-256"),
    rawBody: raw,
    allowUnsigned: process.env.ALLOW_UNSIGNED_WEBHOOKS,
    publicUrl: process.env.PUBLIC_URL,
  });
  if (!policy.ok) {
    console.warn(`[meta webhook] rejected: ${policy.reason}`);
    return new Response("forbidden", { status: 403 });
  }

  let items: MetaInbound[] = [];
  try {
    const body = JSON.parse(raw);
    items = parseMetaPayload(body);
    // WhatsApp send failures are only reported here (e.g. 131047: 24 h window closed). Log code only, no phone numbers.
    for (const f of parseMetaStatusFailures(body)) console.warn(`[meta webhook] whatsapp delivery failed code=${f.code} title=${f.title}`);
  } catch { return new Response("bad request", { status: 400 }); }

  // Answer Meta right away; process after the response is sent.
  if (items.length > 0) {
    after(async () => {
      for (const item of items) {
        try { await processOne(item); } catch { console.error(`[meta webhook] processing failed channel=${item.channel}`); }
      }
    });
  }
  return new Response("ok", { status: 200 });
}
