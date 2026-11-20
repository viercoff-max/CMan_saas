// L8 (REVIEW-security-2): reserved tenant slugs / names. The TS list must equal the SQL list create_tenant enforces.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RESERVED_SUBSTRING, RESERVED_TENANT_WORDS, isReservedName, isReservedSlug, isValidSlug, slugify } from "../slug";

const MIGRATION = path.join(process.cwd(), "supabase", "migrations", "20261120013725_create_tenant_reserved_names.sql");

describe("reserved tenant words", () => {
  it("are identical in src/lib/auth/slug.ts and the create_tenant migration", () => {
    const sql = fs.readFileSync(MIGRATION, "utf8");
    const fn = sql.slice(sql.indexOf("is_reserved_tenant_word(p text)"), sql.indexOf("$$;", sql.indexOf("is_reserved_tenant_word(p text)")));
    const arr = fn.slice(fn.indexOf("array["), fn.indexOf("]", fn.indexOf("array[")));
    const words = [...arr.matchAll(/'([a-z0-9-]+)'/g)].map((m) => m[1]);
    expect([...words].sort()).toEqual([...RESERVED_TENANT_WORDS].sort());
    expect(fn).toContain(`like '%${RESERVED_SUBSTRING}%'`);
  });

  it("slugs: exact reserved words and anything with the platform brand; normal businesses pass", () => {
    for (const s of ["admin", "API", " www ", "support", "platform", "conversa", "login", "signup", "momentia", "momentia-mx"]) {
      expect(isReservedSlug(s)).toBe(true);
      expect(isValidSlug(s.trim().toLowerCase())).toBe(false);
    }
    for (const s of ["cafe-aurora", "admin-store", "soporte-tecnico-juan", "chefman-fan-club"]) {
      expect(isReservedSlug(s)).toBe(false);
      expect(isValidSlug(s)).toBe(true);
    }
  });

  it("names: letters/digits only, punctuation and spaces ignored", () => {
    for (const n of ["Admin", "A.D.M.I.N", "Soporte", "Momentia Support", "  Conversa  ", "Sup-port"]) expect(isReservedName(n)).toBe(true);
    for (const n of ["Café Aurora", "Soporte Técnico Juan", "Chefman Fans MX"]) expect(isReservedName(n)).toBe(false);
  });

  it("slugify never suggests a reserved slug", () => {
    expect(slugify("Admin")).toBe("admin-negocio");
    expect(slugify("Soporte")).toBe("soporte-negocio");
    expect(slugify("Momentia")).toBe("negocio");
    expect(slugify("Café Aurora & Co.")).toBe("cafe-aurora-co");
    for (const w of RESERVED_TENANT_WORDS) expect(isValidSlug(slugify(w))).toBe(true);
  });
});
