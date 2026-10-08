// Small helpers for the inbox route handlers.
import { requireSession, type Session } from "../auth";

export const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

/** Runs a handler with a valid session; maps thrown Responses (401) and unexpected errors to JSON. */
export async function withSession(fn: (s: Session) => Promise<Response> | Response): Promise<Response> {
  let session: Session;
  try {
    session = await requireSession();
  } catch (e) {
    if (e instanceof Response) return e;
    return json({ error: "unauthorized" }, 401);
  }
  try {
    return await fn(session);
  } catch {
    console.error("[inbox api] unexpected error");
    return json({ error: "server_error" }, 500);
  }
}
