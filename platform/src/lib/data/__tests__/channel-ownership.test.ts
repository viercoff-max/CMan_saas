// L2 (REVIEW-security-2): the "already connected to another brand" answer is only given after credentials are valid.
import "../../channels/__tests__/env-secrets";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { getData } from "..";
import { connectAfterValidation } from "../channel-ownership";

describe("connectAfterValidation", () => {
  it("never reveals ownership to a caller whose credentials fail; refuses in_use only after they pass", async () => {
    const data = getData();
    const owner = await data.tenants.ensure(`own-${randomUUID()}`, "Dueño");
    const prober = await data.tenants.ensure(`prb-${randomUUID()}`, "Curioso");
    const page = `page-${randomUUID()}`;
    await data.channels.save(owner, "messenger", { status: "connected", publicInfo: { externalId: page } });

    const lookup = vi.spyOn(data.channels, "findTenantByExternalId");
    const bad = await connectAfterValidation(prober, "messenger", page, async () => ({ ok: false as const, error: "token" as const }));
    expect(bad).toEqual({ ok: false, error: "token" }); // same answer as for a free Page with a bad token
    expect(lookup).not.toHaveBeenCalled();

    const good = await connectAfterValidation(prober, "messenger", page, async () => ({ ok: true as const, name: "Página" }));
    expect(good).toEqual({ ok: false, error: "in_use" });
    expect(lookup).toHaveBeenCalledTimes(1);

    // The owner itself (re-connect) and a free Page pass through with the validation result.
    expect(await connectAfterValidation(owner, "messenger", page, async () => ({ ok: true as const, name: "P" }))).toEqual({ ok: true, name: "P" });
    expect(await connectAfterValidation(prober, "messenger", `page-${randomUUID()}`, async () => ({ ok: true as const, name: "Libre" }))).toEqual({ ok: true, name: "Libre" });
    lookup.mockRestore();
  });
});
