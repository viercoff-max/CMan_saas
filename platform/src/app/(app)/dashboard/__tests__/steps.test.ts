// Dashboard checklist: agents only get steps they can do; exactly one primary (the first unfinished required step).
import { describe, expect, it } from "vitest";
import { buildSteps, type StepState } from "../steps";

const none: StepState = { context: false, tone: false, sources: false, tested: false, channels: false, team: false, brand: false, shop: false, shopDemo: false, canInvite: true };

describe("buildSteps", () => {
  it("admins: the full list in order; next = first unfinished required step", () => {
    const { steps, nextIdx } = buildSteps("admin", none);
    expect(steps.map((s) => s.id)).toEqual(["context", "tone", "sources", "test", "channels", "team", "brand", "addons"]);
    expect(steps[nextIdx].id).toBe("context");
    expect(buildSteps("owner", { ...none, context: true, tone: true }).steps[buildSteps("owner", { ...none, context: true, tone: true }).nextIdx].id).toBe("sources");
  });
  it("optional steps (brand, Shopify) are never the primary; all required done -> no primary", () => {
    const done = { ...none, context: true, tone: true, sources: true, tested: true, channels: true, team: true };
    expect(buildSteps("admin", done).nextIdx).toBe(-1);
  });
  it("no invitations in SQLite mode -> no team step", () => {
    expect(buildSteps("admin", { ...none, canInvite: false }).steps.some((s) => s.id === "team")).toBe(false);
  });
  it("agents only see the simulator test", () => {
    const { steps, nextIdx } = buildSteps("agent", { ...none, context: true });
    expect(steps.map((s) => s.id)).toEqual(["test"]);
    expect(nextIdx).toBe(0);
    expect(buildSteps("agent", { ...none, tested: true }).nextIdx).toBe(-1);
  });
  it("a demo Shopify store does not count as done", () => {
    const st = buildSteps("admin", { ...none, shop: true, shopDemo: true }).steps.find((s) => s.id === "addons");
    expect(st?.done).toBe(false);
  });
});
