// Route helpers: session -> tenant (never from the request body), JSON responses.
import { requireSession } from "../auth";

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Returns the tenantId, or a Response (401) the route must return as is. */
export async function tenantOr401(): Promise<string | Response> {
  try { return (await requireSession()).tenantId; } catch (e) {
    if (e instanceof Response) return e;
    throw e;
  }
}

export function publicUrl(req: Request): string {
  return (process.env.PUBLIC_URL || new URL(req.url).origin).replace(/\/+$/, "");
}
