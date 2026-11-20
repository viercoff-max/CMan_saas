// L2 (REVIEW-security-2): channel-ownership oracle. "This Page / IG account / number is already connected to another
// brand" must only be revealed to someone who PROVED they control the account (valid credentials), otherwise any
// tenant admin could probe arbitrary Page ids to learn which brands use the platform.
// Use connectAfterValidation() from the channel connect action instead of calling channels.findTenantByExternalId
// before the credential test. The partial unique index uq_channel_external (both backends) stays the race-proof
// backstop when channels.save runs (DataConflictError -> also "in_use").
import { getData } from "./index";
import type { ChannelAccountKey } from "./types";

export type OwnershipChecked<R> = R | { ok: false; error: "in_use" };

/**
 * 1) runs `validateCredentials` (e.g. the Graph / getMe test) FIRST and returns its failure unchanged, without ever
 *    looking at who owns the account; 2) only after a successful validation, refuses with "in_use" when another
 *    tenant has this external id connected; 3) otherwise returns the validation result for the caller to save.
 * The lookup is cross-tenant by design but returns no tenant id, only the boolean outcome.
 */
export async function connectAfterValidation<R extends { ok: boolean }>(
  tenantId: string,
  channel: ChannelAccountKey,
  externalId: string,
  validateCredentials: () => Promise<R>,
): Promise<OwnershipChecked<R>> {
  const validated = await validateCredentials();
  if (!validated.ok) return validated;
  const owner = await getData().channels.findTenantByExternalId(channel, externalId);
  if (owner && owner !== tenantId) return { ok: false, error: "in_use" };
  return validated;
}
