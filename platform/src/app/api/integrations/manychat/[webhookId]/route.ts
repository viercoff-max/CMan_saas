// ManyChat -> Conversa: POST /api/integrations/manychat/<webhookId>, called by an External Request (or Dynamic
// Block) step in the business's ManyChat flow. Auth: "Authorization: Bearer <request token>" compared in constant
// time with the tenant's encrypted token (fail closed: unknown id, disconnected, wrong token -> 401).
// Body (JSON): { "subscriber_id": "<Contact Id>", "text": "<Last Text Input>", "name"?: "<Full Name>",
//               "channel"?: "instagram" | "messenger" | "whatsapp" | "telegram" }
//   ManyChat's "Full Contact Data" object is accepted too ({ id, name, last_input_text, ... }).
// Reply (synchronous, same request): a Dynamic Block v2 ({ version, content: { messages } }) so ManyChat can send it
// as is, plus flat fields to map into custom fields: reply, needs_human, reason, status, conversation_id.
// The conversation is stored in the inbox like any other channel; a person can answer it there (ManyChat API).
// Never logs tokens, message text or contact names.
import { z } from "zod";
import { handleInbound } from "@/lib/engine";
import { getData } from "@/lib/data";
import { hit } from "@/lib/security/rate-limit";
import { authenticateManychat, dynamicBlock, isManychatSubChannel, MANYCHAT_TEXT_LIMIT } from "@/lib/channels/manychat";
import { splitMessage } from "@/lib/channels/send";
import { HUMAN_OWNED_STATUSES } from "@/lib/types";

export const dynamic = "force-dynamic";

const WEBHOOK_ID_SHAPE = /^[A-Za-z0-9-]{8,64}$/;
const MAX_BODY_BYTES = 64_000;
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

const Id = z.union([z.string().trim().regex(/^\d{1,15}$/), z.number().int().positive().max(999_999_999_999_999)]).transform(String);
const Body = z.object({
  subscriber_id: Id.optional(), id: Id.optional(),
  text: z.string().max(4000).optional(), last_input_text: z.string().max(4000).optional(),
  name: z.string().max(200).optional(), full_name: z.string().max(200).optional(),
  channel: z.string().max(20).optional(),
}).passthrough();

export async function POST(req: Request, ctx: { params: Promise<{ webhookId: string }> }) {
  const { webhookId } = await ctx.params;
  if (!WEBHOOK_ID_SHAPE.test(webhookId ?? "")) return json({ error: "unauthorized" }, 401);
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413);
  const auth = await authenticateManychat(webhookId, req.headers.get("authorization"));
  if (!auth) return json({ error: "unauthorized" }, 401);
  const { tenantId } = auth;
  if (!(await hit(`manychat:${tenantId}`, 300, 60_000)).ok) return json({ error: "rate_limited" }, 429);

  const raw = await req.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_BODY_BYTES) return json({ error: "payload_too_large" }, 413);
  let parsed;
  try { parsed = Body.safeParse(JSON.parse(raw)); } catch { return json({ error: "invalid_json" }, 400); }
  if (!parsed.success) return json({ error: "invalid_body" }, 400);
  const b = parsed.data;
  const subscriberId = b.subscriber_id ?? b.id;
  const text = (b.text ?? b.last_input_text ?? "").trim();
  if (!subscriberId || !text) return json({ error: "missing_fields", required: ["subscriber_id", "text"] }, 400);
  const name = (b.name ?? b.full_name ?? "").trim();
  const sub = isManychatSubChannel(b.channel) ? b.channel : null;

  // Remember which ManyChat channel the contact uses, so an inbox reply goes out in the right format.
  const data = getData();
  const conv0 = await data.conversations.getOrCreate(tenantId, "manychat", subscriberId, name);
  if (sub && conv0.state.manychatChannel !== sub) await data.conversations.setState(tenantId, conv0.id, { ...conv0.state, manychatChannel: sub });

  const reply = await handleInbound({ tenantId, channel: "manychat", externalId: subscriberId, customerName: name || undefined, text });
  const conv = await data.conversations.get(tenantId, conv0.id);
  const status = conv?.status ?? "bot";
  const needsHuman = reply.escalated || HUMAN_OWNED_STATUSES.has(status);
  const parts = reply.text ? splitMessage(reply.text, MANYCHAT_TEXT_LIMIT, "chars") : [];
  return json({
    ...dynamicBlock(parts, sub),
    reply: reply.text,
    needs_human: needsHuman,
    reason: reply.reason ?? conv?.escalationReason ?? null,
    status,
    conversation_id: conv0.id,
  });
}
