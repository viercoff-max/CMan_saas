import { getDb } from "../db";

/** True once the tenant has saved the Tone screen at least once (stable: based on the audit log, not on row defaults). */
export function isToneSaved(tenantId: string): boolean {
  const r = getDb().prepare("SELECT 1 AS x FROM audit_log WHERE tenant_id=? AND action='settings.save' AND detail='tone' LIMIT 1").get(tenantId);
  return !!r;
}
