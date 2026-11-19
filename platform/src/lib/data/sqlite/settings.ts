// Agent settings and brand settings (SQLite).
import { newId, nowIso } from "../../ids";
import type { AgentSettings } from "../../types";
import { BRAND_DEFAULTS, clampCrossSell, clampTone, validateBrand } from "../rules";
import type { BrandRepo, BrandSettings, SettingsRepo } from "../types";
import { db, type Row } from "./conn";

function mapSettings(r: Row): AgentSettings {
  return {
    tenantId: r.tenant_id as string, agentName: r.agent_name as string,
    toneLevel: r.tone_level as AgentSettings["toneLevel"],
    languageDefault: r.language_default as AgentSettings["languageDefault"],
    languageAlt: r.language_alt as AgentSettings["languageAlt"],
    greeting: r.greeting as string, fallbackMessage: r.fallback_message as string,
    handoffEmail: r.handoff_email as string, businessHours: r.business_hours as string,
    crossSellLevel: r.cross_sell_level as AgentSettings["crossSellLevel"], botEnabled: !!r.bot_enabled,
  };
}
function readSettings(tenantId: string): AgentSettings {
  const d = db();
  d.prepare("INSERT OR IGNORE INTO agent_settings (tenant_id) VALUES (?)").run(tenantId);
  return mapSettings(d.prepare("SELECT * FROM agent_settings WHERE tenant_id = ?").get(tenantId) as Row);
}

const TONE_ACTION = "settings.save";
const TONE_DETAIL = "tone";

export const settings: SettingsRepo = {
  async get(tenantId) { return readSettings(tenantId); },
  async save(tenantId, patch) {
    const n = { ...readSettings(tenantId), ...patch };
    const tone = clampTone(n.toneLevel);
    const cs = clampCrossSell(n.crossSellLevel);
    db().prepare(
      `UPDATE agent_settings SET agent_name=?, tone_level=?, language_default=?, language_alt=?, greeting=?,
       fallback_message=?, handoff_email=?, business_hours=?, cross_sell_level=?, bot_enabled=?, updated_at=? WHERE tenant_id=?`
    ).run(n.agentName, tone, n.languageDefault, n.languageAlt, n.greeting, n.fallbackMessage, n.handoffEmail,
      n.businessHours, cs, n.botEnabled ? 1 : 0, nowIso(), tenantId);
    return readSettings(tenantId);
  },
  // Stable marker based on the audit log (not on row defaults), as before the data layer existed.
  async isToneSaved(tenantId) {
    return !!db().prepare("SELECT 1 AS x FROM audit_log WHERE tenant_id=? AND action=? AND detail=? LIMIT 1").get(tenantId, TONE_ACTION, TONE_DETAIL);
  },
  async markToneSaved(tenantId, actor) {
    db().prepare("INSERT INTO audit_log (id, tenant_id, actor, action, detail) VALUES (?,?,?,?,?)").run(newId(), tenantId, actor, TONE_ACTION, TONE_DETAIL);
  },
};

// ---------- brand (white-label) ----------
function readBrand(tenantId: string): BrandSettings {
  const d = db();
  const r = d.prepare("SELECT * FROM brand_settings WHERE tenant_id = ?").get(tenantId) as Row | undefined;
  if (!r) {
    // Like create_tenant in Supabase: the display name starts as the tenant name.
    const t = d.prepare("SELECT name FROM tenants WHERE id = ?").get(tenantId) as Row | undefined;
    return { tenantId, displayName: String(t?.name ?? ""), logoPath: null, ...BRAND_DEFAULTS, updatedAt: null };
  }
  return {
    tenantId, displayName: r.display_name as string, logoPath: (r.logo_path as string) ?? null,
    primaryColor: r.primary_color as string, accentColor: r.accent_color as string, menuBgColor: r.menu_bg_color as string,
    headingFont: r.heading_font as string, updatedAt: r.updated_at as string,
  };
}

export const brand: BrandRepo = {
  async get(tenantId) { return readBrand(tenantId); },
  async save(tenantId, patch) {
    const cur = readBrand(tenantId);
    const n = {
      displayName: patch.displayName ?? cur.displayName, logoPath: patch.logoPath === undefined ? cur.logoPath : patch.logoPath,
      primaryColor: patch.primaryColor ?? cur.primaryColor, accentColor: patch.accentColor ?? cur.accentColor,
      menuBgColor: patch.menuBgColor ?? cur.menuBgColor, headingFont: patch.headingFont ?? cur.headingFont,
    };
    validateBrand(n);
    db().prepare(
      `INSERT INTO brand_settings (tenant_id, display_name, logo_path, primary_color, accent_color, menu_bg_color, heading_font, updated_at)
       VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(tenant_id) DO UPDATE SET display_name=excluded.display_name, logo_path=excluded.logo_path,
       primary_color=excluded.primary_color, accent_color=excluded.accent_color, menu_bg_color=excluded.menu_bg_color,
       heading_font=excluded.heading_font, updated_at=excluded.updated_at`
    ).run(tenantId, n.displayName, n.logoPath, n.primaryColor, n.accentColor, n.menuBgColor, n.headingFont, nowIso());
    return readBrand(tenantId);
  },
};
