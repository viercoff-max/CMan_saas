// Add-ons, channel accounts and their secrets (Supabase).
//   * Secrets live in public.tenant_secrets (kind, key) as lib/crypto.ts AES-GCM ciphertext; no client role can read
//     that table (no grants, no policies). Only `secrets` touches it, so addon/channel reads can never leak a token.
//   * channel_accounts.external_id is a real column (from publicInfo.externalId) with the partial unique index
//     uq_channel_external: a 23505 there becomes DataConflictError("channel_in_use").
import { decryptJson, encryptJson } from "../../crypto";
import { nowIso } from "../../ids";
import type { AddonsRepo, ChannelsRepo, SecretsRepo } from "../types";
import { scoped, type Db, type Scoped } from "./client";
import { externalIdOf, mapAddon, mapChannel, one, rows, run } from "./map";

const clearSecret = (s: Scoped, kind: string, key: string, ctx: string) =>
  run(s.from("tenant_secrets").update({ config_enc: null, updated_at: nowIso() }).eq("kind", kind).eq("key", key), ctx);

export function addonsRepo(db: Db): AddonsRepo {
  return {
    async get(tenantId, key) {
      const r = await one(scoped(db, tenantId).from("addons").select("status, public_info, connected_at").eq("key", key).maybeSingle(), "addons.get");
      return mapAddon(key, r);
    },
    async save(tenantId, key, v) {
      const s = scoped(db, tenantId);
      // Privacy first: wipe the token before the status says "disconnected".
      if (v.status === "disconnected") await clearSecret(s, "addon", key, "addons.save");
      await run(s.from("addons").upsert({
        key, status: v.status, public_info: v.publicInfo ?? {}, connected_at: v.status === "connected" ? nowIso() : null,
      }, { onConflict: "tenant_id,key" }), "addons.save");
    },
  };
}

export function channelsRepo(db: Db): ChannelsRepo {
  return {
    async get(tenantId, channel) {
      const r = await one(scoped(db, tenantId).from("channel_accounts").select("status, public_info").eq("channel", channel).maybeSingle(), "channels.get");
      return mapChannel(channel, r);
    },
    async save(tenantId, channel, v) {
      const publicInfo = v.publicInfo ?? {};
      // run() maps 23505 on uq_channel_external to DataConflictError("channel_in_use").
      await run(scoped(db, tenantId).from("channel_accounts").upsert({
        channel, status: v.status, public_info: publicInfo, external_id: externalIdOf(publicInfo),
        connected_at: v.status === "connected" ? nowIso() : null,
      }, { onConflict: "tenant_id,channel" }), "channels.save");
    },
    // CROSS-TENANT by design (webhook routing): which tenant has this external id connected.
    async findTenantByExternalId(channel, externalId) {
      const ext = String(externalId ?? "").trim();
      if (!ext) return null;
      const rs = await rows(db.from("channel_accounts").select("tenant_id").eq("channel", channel).eq("external_id", ext).eq("status", "connected").limit(1), "channels.findTenantByExternalId");
      return (rs[0]?.tenant_id as string) ?? null;
    },
  };
}

export function secretsRepo(db: Db): SecretsRepo {
  return {
    async get<T>(tenantId: string, kind: "channel" | "addon", key: string): Promise<T | null> {
      const r = await one(scoped(db, tenantId).from("tenant_secrets").select("config_enc").eq("kind", kind).eq("key", key).maybeSingle(), "secrets.get");
      return r?.config_enc ? decryptJson<T>(r.config_enc as string) : null;
    },
    async set(tenantId, kind, key, value) {
      await run(scoped(db, tenantId).from("tenant_secrets").upsert(
        { kind, key, config_enc: encryptJson(value), updated_at: nowIso() }, { onConflict: "tenant_id,kind,key" },
      ), "secrets.set");
    },
    async clear(tenantId, kind, key) { await clearSecret(scoped(db, tenantId), kind, key, "secrets.clear"); },
  };
}
