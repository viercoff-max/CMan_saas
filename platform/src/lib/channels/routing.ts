// Webhook -> tenant routing (kept out of the route file: Next only allows handler exports there).
import { findTenantByChannelExternalId } from "../store";
import type { MetaInbound } from "./meta";

/** Tenant that owns the receiving account: entry.id first, then (Instagram) recipient.id. */
export function routeTenant(item: Pick<MetaInbound, "channel" | "accountId" | "altAccountIds">): string | null {
  for (const id of [item.accountId, ...(item.altAccountIds ?? [])]) {
    const t = id ? findTenantByChannelExternalId(item.channel, id) : null;
    if (t) return t;
  }
  return null;
}
