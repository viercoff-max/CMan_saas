// Role-aware shell: agents never see admin nav items, and an agent opening an admin page by URL is redirected
// (to /inbox) BEFORE the page reads or renders anything.
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@/lib/auth/session";

const h = vi.hoisted(() => ({ session: null as Session | null, redirects: [] as string[] }));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), getSession: async () => h.session }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { h.redirects.push(to); throw new Error(`NEXT_REDIRECT:${to}`); },
}));

import { AGENT_HOME, adminPageRedirect, requireAdminPage, requireMemberPage } from "../guards";
import { ADMIN_PATHS, navFor } from "../nav";

const s = (role: Session["role"]): Session => ({ userId: "u1", tenantId: "t1", role, name: "Ana", email: "a@example.com", tenants: [{ id: "t1", name: "T", role }] });
beforeEach(() => { h.session = null; h.redirects = []; });

describe("admin page guard", () => {
  it("pure rule", () => {
    expect(adminPageRedirect(null)).toBe("/login");
    expect(adminPageRedirect(s("agent"))).toBe(AGENT_HOME);
    expect(AGENT_HOME).toBe("/inbox");
    expect(adminPageRedirect(s("admin"))).toBeNull();
    expect(adminPageRedirect(s("owner"))).toBeNull();
    expect(adminPageRedirect({ ...s("admin"), role: "superuser" as never })).toBe(AGENT_HOME); // unknown role = least privilege
  });
  it("requireAdminPage redirects agents to /inbox and anonymous users to /login", async () => {
    h.session = s("agent");
    await expect(requireAdminPage()).rejects.toThrow("NEXT_REDIRECT:/inbox");
    h.session = null;
    await expect(requireAdminPage()).rejects.toThrow("NEXT_REDIRECT:/login");
    h.session = s("admin");
    await expect(requireAdminPage()).resolves.toMatchObject({ role: "admin" });
    expect(h.redirects).toEqual(["/inbox", "/login"]);
  });
  it("requireMemberPage lets agents in (Plan y uso is for every member)", async () => {
    h.session = s("agent");
    await expect(requireMemberPage()).resolves.toMatchObject({ role: "agent" });
  });

  it("every admin page calls the guard as its FIRST statement (no data read before the redirect)", () => {
    const app = path.resolve(__dirname, "../../app/(app)");
    for (const p of ["tone", "context", "sources", "addons", "brand", "team"]) {
      const src = readFileSync(path.join(app, p, "page.tsx"), "utf8");
      const body = src.slice(src.indexOf("export default async function"));
      const firstStmt = /\)\s*\{\s*\r?\n\s*([^\r\n]+)/.exec(body)?.[1] ?? "";
      expect(firstStmt, p).toMatch(/= await requireAdminPage\(\);/);
    }
  });
});

describe("role-aware navigation", () => {
  const hrefs = (role: Session["role"]) => navFor(role).flatMap((g) => g.items.map((i) => i.href));
  it("agents see only Inicio, Mensajes and Plan y uso", () => {
    expect(hrefs("agent")).toEqual(["/dashboard", "/inbox", "/customers", "/notifications", "/billing"]);
    expect(navFor("agent").every((g) => g.items.length > 0)).toBe(true); // empty groups dropped
  });
  it("admins and owners see everything, including Marca and Plan y uso", () => {
    for (const r of ["admin", "owner"] as const) {
      expect(hrefs(r)).toEqual(["/dashboard", "/inbox", "/customers", "/notifications", "/context", "/tone", "/sources", "/channels", "/addons", "/brand", "/team", "/billing"]);
    }
  });
  it("admin-only paths", () => {
    expect(ADMIN_PATHS.sort()).toEqual(["/addons", "/brand", "/channels", "/context", "/sources", "/team", "/tone"]);
  });
});
