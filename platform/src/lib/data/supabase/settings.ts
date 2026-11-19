// Agent settings and brand settings (Supabase). isToneSaved/markToneSaved use agent_settings.tone_saved_at
// (markToneSaved also writes the same "settings.save"/"tone" audit row as SQLite, so audit history matches).
import { nowIso } from "../../ids";
import { BRAND_DEFAULTS, clampCrossSell, clampTone, validateBrand } from "../rules";
import type { BrandRepo, SettingsRepo } from "../types";
import { scoped, type Db, type Scoped } from "./client";
import { mapBrand, mapSettings, one, run, settingsToDb } from "./map";

async function readSettings(s: Scoped) {
  const q = () => s.from("agent_settings").select("*").maybeSingle();
  let r = await one(q(), "settings.get");
  if (!r) {
    // Creates the default row on first read (column defaults == SQLite defaults).
    await run(s.from("agent_settings").upsert({}, { onConflict: "tenant_id", ignoreDuplicates: true }), "settings.get");
    r = await one(q(), "settings.get");
  }
  if (!r) throw new Error("agent_settings row missing after insert");
  return mapSettings(r);
}

export function settingsRepo(db: Db): SettingsRepo {
  return {
    async get(tenantId) { return readSettings(scoped(db, tenantId)); },
    async save(tenantId, patch) {
      const s = scoped(db, tenantId);
      const n = { ...(await readSettings(s)), ...patch, tenantId: s.tenantId };
      n.toneLevel = clampTone(n.toneLevel);
      n.crossSellLevel = clampCrossSell(n.crossSellLevel);
      await run(s.from("agent_settings").update({ ...settingsToDb(n), updated_at: nowIso() }), "settings.save");
      return readSettings(s);
    },
    async isToneSaved(tenantId) {
      const r = await one(scoped(db, tenantId).from("agent_settings").select("tone_saved_at").maybeSingle(), "settings.isToneSaved");
      return !!r?.tone_saved_at;
    },
    async markToneSaved(tenantId, actor) {
      const s = scoped(db, tenantId);
      await readSettings(s); // make sure the row exists
      await run(s.from("agent_settings").update({ tone_saved_at: nowIso() }), "settings.markToneSaved");
      await run(s.from("audit_log").insert({ actor: String(actor).slice(0, 80), action: "settings.save", detail: "tone" }), "settings.markToneSaved");
    },
  };
}

export function brandRepo(db: Db): BrandRepo {
  async function readBrand(s: Scoped) {
    const r = await one(s.from("brand_settings").select("*").maybeSingle(), "brand.get");
    if (r) return mapBrand(s.tenantId, r);
    // Like create_tenant: the display name starts as the tenant name.
    const t = await one(db.from("tenants").select("name").eq("id", s.tenantId).maybeSingle(), "brand.get");
    return { tenantId: s.tenantId, displayName: String(t?.name ?? ""), logoPath: null, ...BRAND_DEFAULTS, updatedAt: null };
  }
  return {
    async get(tenantId) { return readBrand(scoped(db, tenantId)); },
    async save(tenantId, patch) {
      const s = scoped(db, tenantId);
      const cur = await readBrand(s);
      const n = {
        displayName: patch.displayName ?? cur.displayName, logoPath: patch.logoPath === undefined ? cur.logoPath : patch.logoPath,
        primaryColor: patch.primaryColor ?? cur.primaryColor, accentColor: patch.accentColor ?? cur.accentColor,
        menuBgColor: patch.menuBgColor ?? cur.menuBgColor, headingFont: patch.headingFont ?? cur.headingFont,
      };
      validateBrand(n);
      await run(s.from("brand_settings").upsert({
        display_name: n.displayName, logo_path: n.logoPath, primary_color: n.primaryColor, accent_color: n.accentColor,
        menu_bg_color: n.menuBgColor, heading_font: n.headingFont, updated_at: nowIso(),
      }, { onConflict: "tenant_id" }), "brand.save");
      return readBrand(s);
    },
  };
}
