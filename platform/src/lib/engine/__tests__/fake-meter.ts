// In-memory UsageMeter for engine tests (engine-test tenants have no tenants row, so the real meter would fail closed).
import type { UsageMeter } from "../usage";

export interface FakeMeter extends UsageMeter {
  /** Tokens left per tenant (default: unlimited). */
  budget: Map<string, number>;
  records: { tenantId: string; requests: number; inputTokens: number; outputTokens: number }[];
  audits: { tenantId: string; detail: string }[];
}

export function fakeMeter(opts: { failRecord?: boolean; failRemaining?: boolean } = {}): FakeMeter {
  const m: FakeMeter = {
    budget: new Map(),
    records: [],
    audits: [],
    remaining: async (t) => {
      if (opts.failRemaining) throw new Error("db down");
      return m.budget.get(t) ?? Number.MAX_SAFE_INTEGER;
    },
    record: async (tenantId, v) => {
      if (opts.failRecord) throw new Error("db down");
      m.records.push({ tenantId, ...v });
      if (m.budget.has(tenantId)) m.budget.set(tenantId, Math.max(0, m.budget.get(tenantId)! - v.inputTokens - v.outputTokens));
    },
    auditExists: async (t, detail) => m.audits.some((a) => a.tenantId === t && a.detail === detail),
    audit: async (tenantId, detail) => { m.audits.push({ tenantId, detail }); },
  };
  return m;
}
