// L6 (REVIEW-security-2): bodies are capped by Content-Length AND by counting the stream.
import { describe, expect, it } from "vitest";
import { formDataCapped, readBodyCapped } from "../body";

const stream = (chunks: number, size: number) => new ReadableStream<Uint8Array>({
  start(c) { for (let i = 0; i < chunks; i++) c.enqueue(new Uint8Array(size)); c.close(); },
});
const req = (body: BodyInit | ReadableStream<Uint8Array>, headers: Record<string, string>) =>
  new Request("https://app.example/x", { method: "POST", body: body as BodyInit, headers, duplex: "half" } as RequestInit);

describe("readBodyCapped", () => {
  it("411 without Content-Length (chunked), 413 when the declared length is too big", async () => {
    expect(((await readBodyCapped(req(stream(1, 10), {}), 100)) as Response).status).toBe(411);
    expect(((await readBodyCapped(req("x".repeat(10), { "content-length": "abc" }), 100)) as Response).status).toBe(411);
    expect(((await readBodyCapped(req("x".repeat(10), { "content-length": "101" }), 100)) as Response).status).toBe(413);
  });
  it("a lying Content-Length cannot make it buffer more than the cap", async () => {
    const r = await readBodyCapped(req(stream(50, 1024), { "content-length": "10" }), 4096);
    expect(r).toBeInstanceOf(Response);
    expect((r as Response).status).toBe(413);
  });
  it("returns the bytes within the cap; formDataCapped parses them", async () => {
    const ok = await readBodyCapped(req("hola", { "content-length": "4" }), 100);
    expect(new TextDecoder().decode(ok as Uint8Array)).toBe("hola");
    const body = "a=1&b=dos";
    const f = await formDataCapped(req(body, { "content-length": String(body.length), "content-type": "application/x-www-form-urlencoded" }), 100);
    expect(f instanceof FormData && [f.get("a"), f.get("b")]).toEqual(["1", "dos"]);
  });
});
