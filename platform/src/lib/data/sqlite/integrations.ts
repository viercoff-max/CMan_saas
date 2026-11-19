// Add-ons, channel accounts and their encrypted secrets (SQLite). Secrets live in the config_enc column of the
// addons / channel_accounts row (Supabase: tenant_secrets); only `secrets` reads or writes that column.
import { decryptJson, encryptJson } from "../../crypto";
import { nowIso } from "../../ids";
import type { Addon, ChannelAccount } from "../../types";
import { DataConflictError } from "../errors";
import type { AddonsRepo, ChannelsRepo, SecretKind, SecretsRepo } from "../types";
import { db, json, type Row } from "./conn";

export const addons: AddonsRepo = {
  async get(tenantId, key) {
    const r = db().prepare("SELECT status, public_info, connected_at FROM addons WHERE tenant_id=? AND key=?").get(tenantId, key) as Row | undefined;
    return { key, status: (r?.status as Addon["status"]) ?? "disconnected", publicInfo: json(r?.public_info), connectedAt: (r?.connected_at as string) ?? null };
  },
  async save(tenantId, key, v) {
    db().prepare(
      `INSERT INTO addons (tenant_id, key, status, config_enc, public_info, connected_at) VALUES (?,?,?,NULL,?,?)
       ON CONFLICT(tenant_id, key) DO UPDATE SET status=excluded.status,
         config_enc = CASE WHEN excluded.status='disconnected' THEN NULL ELSE addons.config_enc END,
         public_info=excluded.public_info, connected_at=excluded.connected_at`
    ).run(tenantId, key, v.status, JSON.stringify(v.publicInfo ?? {}), v.status === "connected" ? nowIso() : null);
  },
};

export const channels: ChannelsRepo = {
  async get(tenantId, channel) {
    const r = db().prepare("SELECT status, public_info FROM channel_accounts WHERE tenant_id=? AND channel=?").get(tenantId, channel) as Row | undefined;
    return { channel, status: (r?.status as ChannelAccount["status"]) ?? "disconnected", publicInfo: json(r?.public_info) };
  },
  async save(tenantId, channel, v) {
    try {
      db().prepare(
        `INSERT INTO channel_accounts (tenant_id, channel, status, config_enc, public_info) VALUES (?,?,?,NULL,?)
         ON CONFLICT(tenant_id, channel) DO UPDATE SET status=excluded.status, public_info=excluded.public_info`
      ).run(tenantId, channel, v.status, JSON.stringify(v.publicInfo ?? {}));
    } catch (e) {
      // uq_channel_external (db.ts): another tenant already has this external id connected.
      if (e instanceof Error && /UNIQUE constraint failed/i.test(e.message)) throw new DataConflictError("channel_in_use");
      throw e;
    }
  },
  async findTenantByExternalId(channel, externalId) {
    const rows = db().prepare("SELECT tenant_id, public_info FROM channel_accounts WHERE channel=? AND status='connected'").all(channel) as Row[];
    return (rows.find((r) => json(r.public_info).externalId === externalId)?.tenant_id as string) ?? null;
  },
};

const TABLE: Record<SecretKind, { table: string; col: string }> = {
  addon: { table: "addons", col: "key" },
  channel: { table: "channel_accounts", col: "channel" },
};

export const secrets: SecretsRepo = {
  async get<T>(tenantId: string, kind: SecretKind, key: string): Promise<T | null> {
    const t = TABLE[kind];
    const r = db().prepare(`SELECT config_enc FROM ${t.table} WHERE tenant_id=? AND ${t.col}=?`).get(tenantId, key) as Row | undefined;
    return r?.config_enc ? decryptJson<T>(r.config_enc as string) : null;
  },
  async set(tenantId, kind, key, value) {
    const t = TABLE[kind];
    // Upsert on the owning row so secrets can be stored before the status row exists (status stays as it is).
    db().prepare(
      `INSERT INTO ${t.table} (tenant_id, ${t.col}, config_enc) VALUES (?,?,?)
       ON CONFLICT(tenant_id, ${t.col}) DO UPDATE SET config_enc=excluded.config_enc`
    ).run(tenantId, key, encryptJson(value));
  },
  async clear(tenantId, kind, key) {
    const t = TABLE[kind];
    db().prepare(`UPDATE ${t.table} SET config_enc=NULL WHERE tenant_id=? AND ${t.col}=?`).run(tenantId, key);
  },
};

