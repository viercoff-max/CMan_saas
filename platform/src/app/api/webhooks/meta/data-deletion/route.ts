import { deletionStatus, handleMetaDataDeletion } from "@/lib/retention/meta-deletion";

export const dynamic = "force-dynamic";

// Meta "Data Deletion Request Callback". Meta POSTs application/x-www-form-urlencoded with `signed_request`.
// Authenticity is the HMAC signature inside signed_request (verified by handleMetaDataDeletion), so there is no
// cookie/session and no same-origin check here. Response per Meta's spec: JSON { url, confirmation_code }.
const noStore = { "content-type": "application/json", "cache-control": "no-store" };

export async function POST(req: Request) {
  let signed = "";
  try {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/x-www-form-urlencoded")) {
      signed = new URLSearchParams(await req.text()).get("signed_request") ?? "";
    } else {
      const fd = await req.formData();
      const v = fd.get("signed_request");
      signed = typeof v === "string" ? v : "";
    }
  } catch {
    return new Response(JSON.stringify({ error: "bad_request" }), { status: 400, headers: noStore });
  }
  if (!signed || signed.length > 4096) return new Response(JSON.stringify({ error: "bad_request" }), { status: 400, headers: noStore });

  try {
    const r = await handleMetaDataDeletion(signed);
    return new Response(JSON.stringify({ url: r.url, confirmation_code: r.confirmation_code }), { status: 200, headers: noStore });
  } catch {
    // Invalid signature / malformed payload. Never echo details.
    console.warn("[meta data-deletion] rejected request");
    return new Response(JSON.stringify({ error: "invalid_signed_request" }), { status: 400, headers: noStore });
  }
}

// Status URL returned to Meta (and shown to the person): /api/webhooks/meta/data-deletion?code=XXXX.
// Public and read-only: answers only whether that confirmation code was received (no PII).
export async function GET(req: Request) {
  const code = (new URL(req.url).searchParams.get("code") ?? "").trim().slice(0, 64);
  const status = code ? deletionStatus(code) : "unknown";
  return new Response(JSON.stringify({
    confirmation_code: code || null,
    status,
    message: status === "received"
      ? "Your data deletion request was received and processed. / Recibimos y procesamos tu solicitud de eliminación de datos."
      : "We have no deletion request with that code. / No encontramos una solicitud con ese código.",
  }), { status: 200, headers: noStore });
}
