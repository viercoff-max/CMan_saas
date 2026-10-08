"use server";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { audit, findTenantByChannelExternalId, saveChannelAccount } from "@/lib/store";
import { clearChannelSecrets } from "@/lib/channels/repo";
import { testChannelCredentials, type GraphFailure } from "./graph-test";

const id = z.string().trim().min(3).max(64).regex(/^[A-Za-z0-9_.-]+$/);
const token = z.string().trim().min(10).max(1024);

const Schemas = {
  whatsapp: z.object({ externalId: id, accessToken: token, wabaId: id }),
  instagram: z.object({ externalId: id, accessToken: token }),
  messenger: z.object({ externalId: id, accessToken: token }),
} as const;
type Ch = keyof typeof Schemas;
const isCh = (c: string): c is Ch => c in Schemas;

export type ConnectResult = { ok: true; name: string } | { ok: false; error: GraphFailure | "invalid" | "auth" | "in_use" };

/**
 * Tests the credentials against the Graph API first (and subscribes the app to the account's webhooks); stores the
 * channel as connected only if both pass.
 */
export async function connectChannel(channel: string, input: unknown): Promise<ConnectResult> {
  const s = await getSession();
  if (!s || !isCh(channel)) return { ok: false, error: "auth" };
  const p = Schemas[channel].safeParse(input);
  if (!p.success) return { ok: false, error: "invalid" };
  const d = p.data as { externalId: string; accessToken: string; wabaId?: string };

  // One Page / IG account / WhatsApp number belongs to ONE brand (webhook routing). Checked before calling Graph, and the
  // unique index uq_channel_external (db.ts) is the race-proof backstop below.
  const owner = findTenantByChannelExternalId(channel, d.externalId);
  if (owner && owner !== s.tenantId) {
    audit(s.tenantId, s.userId, "channel.connect_failed", `${channel}:in_use`);
    return { ok: false, error: "in_use" };
  }

  const test = await testChannelCredentials(channel, d);
  if (!test.ok) {
    audit(s.tenantId, s.userId, "channel.connect_failed", `${channel}:${test.error}`);
    return { ok: false, error: test.error };
  }

  const secrets = channel === "whatsapp"
    ? { phoneNumberId: d.externalId, accessToken: d.accessToken, wabaId: d.wabaId }
    : channel === "instagram"
      ? { igId: d.externalId, accessToken: d.accessToken, ...(test.igLogin ? { igLogin: "1" } : {}) }
      : { pageId: d.externalId, accessToken: d.accessToken };
  try {
    saveChannelAccount(s.tenantId, channel, {
      status: "connected", secrets, publicInfo: { externalId: d.externalId, displayName: test.name },
    });
  } catch (e) {
    if (e instanceof Error && /UNIQUE constraint failed/i.test(e.message)) {
      audit(s.tenantId, s.userId, "channel.connect_failed", `${channel}:in_use`);
      return { ok: false, error: "in_use" };
    }
    throw e;
  }
  audit(s.tenantId, s.userId, "channel.connect", channel);
  revalidatePath("/channels");
  return { ok: true, name: test.name };
}

export async function disconnectChannel(channel: string): Promise<{ ok: boolean }> {
  const s = await getSession();
  if (!s || !isCh(channel)) return { ok: false };
  saveChannelAccount(s.tenantId, channel, { status: "disconnected", publicInfo: {} });
  clearChannelSecrets(s.tenantId, channel);
  audit(s.tenantId, s.userId, "channel.disconnect", channel);
  revalidatePath("/channels");
  return { ok: true };
}
