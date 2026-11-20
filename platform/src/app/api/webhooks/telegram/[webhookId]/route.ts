// Telegram webhook: POST /api/webhooks/telegram/<webhookId>. One URL per connected bot (webhookId = public routing uuid
// of the tenant's channel row); the X-Telegram-Bot-Api-Secret-Token header (secret_token given to setWebhook) must match
// the tenant's encrypted secret in constant time. Fails closed: unknown id, disconnected bot, missing/wrong secret -> 401.
// Answers 200 fast (Telegram retries non-2xx), then runs the engine and the reply with after().
// Never logs the token, the secret, message text or customer names.
import { after } from "next/server";
import { authenticateTelegramWebhook, TELEGRAM_SECRET_HEADER } from "@/lib/channels/telegram-secret";
import { parseTelegramUpdate, type TelegramInbound } from "@/lib/channels/telegram";
import { handleInbound } from "@/lib/engine";
import { getData } from "@/lib/data";
import { sendToCustomer } from "@/lib/channels/send";

export const dynamic = "force-dynamic";

// Telegram updates are small JSON documents (text <= 4096 chars; files are references, not bytes).
const MAX_BODY_BYTES = 1_000_000;
const WEBHOOK_ID_SHAPE = /^[A-Za-z0-9-]{8,64}$/;

const unauthorized = () => new Response("unauthorized", { status: 401 });

async function processOne(tenantId: string, item: TelegramInbound) {
  const reply = await handleInbound({
    tenantId, channel: "telegram", externalId: item.externalId, customerName: item.customerName || undefined,
    text: item.text, providerMessageId: item.providerMessageId, media: item.media,
  });
  if (!reply.text) return; // duplicate, a person has the conversation, or the bot is off
  const conv = await getData().conversations.getOrCreate(tenantId, "telegram", item.externalId, item.customerName);
  const sent = await sendToCustomer(tenantId, conv, reply.text);
  if (!sent.ok) console.error(`[telegram webhook] reply not delivered error=${sent.error}`);
}

export async function POST(req: Request, ctx: { params: Promise<{ webhookId: string }> }) {
  const { webhookId } = await ctx.params;
  if (!WEBHOOK_ID_SHAPE.test(webhookId ?? "")) return unauthorized();
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return new Response("payload too large", { status: 413 });

  const auth = await authenticateTelegramWebhook(webhookId, req.headers.get(TELEGRAM_SECRET_HEADER));
  if (!auth) return unauthorized();

  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return new Response("payload too large", { status: 413 });
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return new Response("bad request", { status: 400 }); }

  const parsed = parseTelegramUpdate(body);
  if (parsed.ok) {
    const { tenantId } = auth;
    const item = parsed.item;
    after(async () => {
      try { await processOne(tenantId, item); } catch { console.error("[telegram webhook] processing failed"); }
    });
  }
  return new Response("ok", { status: 200 });
}
