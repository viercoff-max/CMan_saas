// Brand saving: form validation, admin-only (agent 403), the logo flow on a mocked FileStore (upload -> save ->
// remove old), audit with changed field NAMES only, and cross-tenant negatives (tenant A's admin can never touch
// tenant B's brand or logo). Runs on the temp SQLite store; the route handler is called directly with a mocked session.
import "../../channels/__tests__/env-secrets";
import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../../auth/session";

const auth = vi.hoisted(() => ({ session: null as Session | null }));
vi.mock("@/lib/auth", async (orig) => ({ ...(await orig<typeof import("@/lib/auth")>()), getSession: async () => auth.session }));

import { AUDIT } from "../../audit-events";
import { getData } from "../../data";
import { __setFileStoreForTests } from "../../storage";
import type { FileInfo, FileStore } from "../../storage/types";
import { LOGO_MAX_BYTES } from "../../storage/logo";
import { parseBrandForm, saveBrand } from "../save";
import { POST } from "@/app/(app)/brand/save/route";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 1, 2, 3]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50]);
const SVG = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

/** In-memory "brand-assets" FileStore (same path rules as the real ones: "<tenantId>/<key>"). */
function memStore(): FileStore & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  const p = (t: string, k: string) => `${t}/${k}`;
  return {
    backend: "local", bucket: "brand-assets", objects,
    async put(t, k, b) { objects.set(p(t, k), b); return p(t, k); },
    async get(t, k) { return objects.get(p(t, k)) ?? null; },
    async remove(t, k) { objects.delete(p(t, k)); },
    async stat(t, k): Promise<FileInfo | null> { const b = objects.get(p(t, k)); return b ? { key: k, size: b.byteLength, updatedAt: null } : null; },
    async list() { return []; },
    publicUrl(t, k) { return `/api/brand-assets/${t}/${k}`; },
  };
}
let store: ReturnType<typeof memStore>;
beforeEach(() => { store = memStore(); __setFileStoreForTests("local", "brand-assets", store); });
afterAll(() => __setFileStoreForTests("local", "brand-assets", null));

async function tenant(prefix: string) { return getData().tenants.ensure(`${prefix}-${randomUUID()}`, `Negocio ${prefix}`); }
const sess = (tenantId: string, role: Session["role"] = "admin", userId = `u-${randomUUID()}`): Session =>
  ({ userId, tenantId, role, name: "Ana", email: "ana@example.com", tenants: [{ id: tenantId, name: "N", role }] });
const audits = (t: string) => getData().audit.list(t, { action: AUDIT.brandSaved });
function form(fields: Record<string, string>, logo?: { bytes: Uint8Array; type: string; name?: string }) {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  if (logo) f.set("logo", new File([logo.bytes as BlobPart], logo.name ?? "logo.png", { type: logo.type }));
  return f;
}
// Like a browser: the multipart body is sent with its Content-Length (the route requires it, L6).
async function req(body: FormData, headers: Record<string, string> = { origin: "http://localhost:3000", "sec-fetch-site": "same-origin" }) {
  const encoded = new Request("http://localhost:3000/brand/save", { method: "POST", body });
  const bytes = new Uint8Array(await encoded.arrayBuffer());
  return new Request("http://localhost:3000/brand/save", {
    method: "POST", body: bytes,
    headers: { host: "localhost:3000", "content-type": encoded.headers.get("content-type")!, "content-length": String(bytes.byteLength), ...headers },
  });
}

describe("parseBrandForm", () => {
  it("accepts valid input, upper-cases colours and ignores absent / empty fields", () => {
    const r = parseBrandForm(form({ primaryColor: "#b42318", accentColor: "", headingFont: "serif", displayName: " Chefman " }));
    expect(r).toEqual({ ok: true, input: { primaryColor: "#B42318", headingFont: "serif", displayName: "Chefman" } });
    expect(parseBrandForm(form({ removeLogo: "1" }))).toEqual({ ok: true, input: { removeLogo: true } });
  });
  it("names the first invalid field", () => {
    expect(parseBrandForm(form({ primaryColor: "red" }))).toEqual({ ok: false, field: "primaryColor" });
    expect(parseBrandForm(form({ menuBgColor: "#12345" }))).toEqual({ ok: false, field: "menuBgColor" });
    expect(parseBrandForm(form({ headingFont: "Comic Sans" }))).toEqual({ ok: false, field: "headingFont" });
    expect(parseBrandForm(form({ displayName: "   " }))).toEqual({ ok: false, field: "displayName" });
    expect(parseBrandForm(form({ displayName: "x".repeat(121) }))).toEqual({ ok: false, field: "displayName" });
  });
});

describe("saveBrand", () => {
  it("agents get forbidden and nothing is written", async () => {
    const A = await tenant("ag");
    const before = await getData().brand.get(A);
    const r = await saveBrand(sess(A, "agent"), { primaryColor: "#B42318" }, { bytes: PNG, type: "image/png" });
    expect(r).toEqual({ ok: false, error: "forbidden" });
    expect(await getData().brand.get(A)).toEqual(before);
    expect(store.objects.size).toBe(0);
    expect(await audits(A)).toHaveLength(0);
  });

  it("admin save: stores the patch, audits the changed field names only", async () => {
    const A = await tenant("ad");
    const s = sess(A, "owner");
    const r = await saveBrand(s, { primaryColor: "#b42318", accentColor: "#2E2B29", menuBgColor: "#F6F7F9", displayName: "Chefman" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changed.sort()).toEqual(["accentColor", "displayName", "primaryColor"]); // menuBgColor was already the default
    expect(r.brand).toMatchObject({ primaryColor: "#B42318", accentColor: "#2E2B29", displayName: "Chefman" });
    const rows = await audits(A);
    expect(rows).toHaveLength(1);
    expect(rows[0].actor).toBe(s.userId);
    expect(rows[0].detail.split(",").sort()).toEqual(["accentColor", "displayName", "primaryColor"]);
    expect(rows[0].detail).not.toMatch(/#|Chefman|@/); // names only: no values, no PII

    const again = await saveBrand(s, { primaryColor: "#B42318" });
    expect(again).toMatchObject({ ok: true, changed: [] });
    expect(await audits(A)).toHaveLength(1); // no-op saves are not audited
  });

  it("rejects invalid values passed directly (not only through the form)", async () => {
    const A = await tenant("inv");
    expect(await saveBrand(sess(A), { primaryColor: "javascript:alert(1)" } as never)).toEqual({ ok: false, error: "invalid" });
    expect(await saveBrand(sess(A), { headingFont: "Papyrus" } as never)).toEqual({ ok: false, error: "invalid" });
  });

  it("logo flow: upload -> save -> old logo removed; bad files change nothing", async () => {
    const A = await tenant("logo");
    const s = sess(A);
    const r1 = await saveBrand(s, {}, { bytes: PNG, type: "image/png" });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const first = r1.brand.logoPath!;
    expect(first).toMatch(new RegExp(`^${A}/logo-[0-9a-f-]{36}\\.png$`));
    expect(store.objects.has(first)).toBe(true);
    expect(r1.logoUrl).toBe(`/api/brand-assets/${first}`);
    expect((await audits(A))[0].detail).toBe("logoPath");

    const r2 = await saveBrand(s, { primaryColor: "#E9A23B" }, { bytes: WEBP, type: "image/webp" });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.brand.logoPath).toMatch(/\.webp$/);
    expect(store.objects.has(first)).toBe(false); // old logo deleted after the successful save
    expect(store.objects.size).toBe(1);

    for (const [bytes, type, error] of [[SVG, "image/svg+xml", "bad_type"], [SVG, "image/png", "bad_type"], [new Uint8Array(), "image/png", "empty"],
      [new Uint8Array(LOGO_MAX_BYTES + 1), "image/png", "too_big"]] as const) {
      const before = await getData().brand.get(A);
      expect(await saveBrand(s, { primaryColor: "#000000" }, { bytes, type })).toEqual({ ok: false, error });
      expect(await getData().brand.get(A)).toEqual(before); // colours not saved either
      expect(store.objects.size).toBe(1);
    }

    const r3 = await saveBrand(s, { removeLogo: true });
    expect(r3).toMatchObject({ ok: true, changed: ["logoPath"], logoUrl: null });
    expect(store.objects.size).toBe(0);
  });

  it("cross-tenant: tenant A's admin never changes tenant B's brand or deletes B's logo", async () => {
    const A = await tenant("xa"), B = await tenant("xb");
    const adminB = sess(B);
    const rb = await saveBrand(adminB, { primaryColor: "#3E2A4F" }, { bytes: PNG, type: "image/png" });
    expect(rb.ok).toBe(true);
    const bBefore = await getData().brand.get(B);
    const bLogo = bBefore.logoPath!;

    // A's admin: the tenant always comes from the session, so this writes A only.
    const adminA = sess(A);
    expect((await saveBrand(adminA, { primaryColor: "#B42318", removeLogo: true })).ok).toBe(true);
    expect(await getData().brand.get(B)).toEqual(bBefore);

    // Even if A's row somehow pointed at B's object, replacing/removing A's logo never deletes it.
    await getData().brand.save(A, { logoPath: bLogo });
    expect((await saveBrand(adminA, {}, { bytes: PNG, type: "image/png" })).ok).toBe(true);
    expect(store.objects.has(bLogo)).toBe(true);
    expect((await saveBrand(adminA, { removeLogo: true })).ok).toBe(true);
    expect(store.objects.has(bLogo)).toBe(true);
    expect(await audits(B)).toHaveLength(1); // only B's own save
  });
});

describe("POST /brand/save", () => {
  it("401 anonymous, 403 agent, 403 cross-origin", async () => {
    const A = await tenant("rt");
    auth.session = null;
    expect((await POST(await req(form({ primaryColor: "#B42318" })))).status).toBe(401);
    auth.session = sess(A, "agent");
    const r = await POST(await req(form({ primaryColor: "#B42318" })));
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ error: "forbidden" });
    auth.session = sess(A);
    expect((await POST(await req(form({ primaryColor: "#B42318" }), { origin: "https://evil.example", "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect((await getData().brand.get(A)).primaryColor).not.toBe("#B42318");
  });

  it("saves the ACTIVE tenant only, ignoring a tenantId in the form", async () => {
    const A = await tenant("ra"), B = await tenant("rb");
    const bBefore = await getData().brand.get(B);
    auth.session = sess(A);
    const r = await POST(await req(form({ tenantId: B, primaryColor: "#B42318", displayName: "Chefman" }, { bytes: PNG, type: "image/png" })));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j).toMatchObject({ ok: true, brand: { primaryColor: "#B42318", displayName: "Chefman" } });
    expect(j.logoUrl).toContain(`/api/brand-assets/${A}/`);
    expect(await getData().brand.get(B)).toEqual(bBefore);
  });

  it("400 with the field name for invalid input; logo errors in plain codes", async () => {
    const A = await tenant("rv");
    auth.session = sess(A);
    const bad = await POST(await req(form({ accentColor: "#GGGGGG" })));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toEqual({ ok: false, error: "invalid", field: "accentColor" });
    const svg = await POST(await req(form({}, { bytes: SVG, type: "image/svg+xml", name: "logo.svg" })));
    expect(svg.status).toBe(400);
    expect(await svg.json()).toEqual({ ok: false, error: "bad_type" });
    const big = await POST(await req(form({}, { bytes: new Uint8Array(LOGO_MAX_BYTES + 10), type: "image/png" })));
    expect(big.status).toBe(413);
    expect(await big.json()).toMatchObject({ error: "too_big" });
  });
});

// L6 (REVIEW-security-2): no Content-Length (chunked) -> 411, a lying length cannot buffer past the cap.
describe("POST /brand/save body cap", () => {
  it("411 without Content-Length; 413 when the stream exceeds the cap whatever the header says", async () => {
    const A = await tenant("cap");
    auth.session = sess(A);
    const chunked = new Request("http://localhost:3000/brand/save", {
      method: "POST", duplex: "half",
      body: new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(10)); c.close(); } }),
      headers: { host: "localhost:3000", origin: "http://localhost:3000", "sec-fetch-site": "same-origin", "content-type": "multipart/form-data; boundary=x" },
    } as RequestInit);
    expect((await POST(chunked)).status).toBe(411);
    const lying = new Request("http://localhost:3000/brand/save", {
      method: "POST", duplex: "half",
      body: new ReadableStream<Uint8Array>({ start(c) { for (let i = 0; i < 40; i++) c.enqueue(new Uint8Array(64 * 1024)); c.close(); } }),
      headers: { host: "localhost:3000", origin: "http://localhost:3000", "sec-fetch-site": "same-origin", "content-type": "multipart/form-data; boundary=x", "content-length": "100" },
    } as RequestInit);
    expect((await POST(lying)).status).toBe(413);
  });
});
