// Request bodies with a HARD size cap (L6, REVIEW-security-2). Content-Length is required (411 otherwise) and checked
// first, then the stream itself is counted while it is read, so a lying or missing length (chunked upload) can never
// make the server buffer more than `max` bytes.
const json = (status: number, error: string) =>
  new Response(JSON.stringify({ ok: false, error }), { status, headers: { "content-type": "application/json" } });

/** The body bytes, or a ready 411 / 413 / 400 Response. */
export async function readBodyCapped(req: Request, max: number): Promise<Uint8Array<ArrayBuffer> | Response> {
  const lenHeader = req.headers.get("content-length");
  if (!lenHeader || !/^\d+$/.test(lenHeader.trim())) return json(411, "length_required");
  const len = Number(lenHeader);
  if (len > max) return json(413, "too_big");
  if (!req.body) return new Uint8Array(0);
  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        return json(413, "too_big");
      }
      parts.push(value);
    }
  } catch {
    return json(400, "invalid");
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.byteLength; }
  return out;
}

/** multipart/form-data or urlencoded body parsed from already-capped bytes. */
export async function formDataCapped(req: Request, max: number): Promise<FormData | Response> {
  const bytes = await readBodyCapped(req, max);
  if (bytes instanceof Response) return bytes;
  try {
    return await new Response(bytes, { headers: { "content-type": req.headers.get("content-type") ?? "" } }).formData();
  } catch {
    return json(400, "invalid");
  }
}
