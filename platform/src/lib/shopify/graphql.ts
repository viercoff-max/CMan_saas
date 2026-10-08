// Minimal Admin GraphQL client: 8 s timeout, 1 retry on 429/5xx/network. Never logs tokens or customer data.
import { SHOPIFY_API_VERSION } from "./config";

export interface GqlResult<T> { data?: T; errors?: { message?: string; extensions?: { code?: string } }[]; status: number }

export async function shopifyGraphql<T>(shop: string, token: string, query: string, variables?: Record<string, unknown>): Promise<GqlResult<T>> {
  const url = `https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`;
  let last: GqlResult<T> = { status: 0 };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-shopify-access-token": token },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
      if (res.status === 429 || res.status >= 500) {
        last = { status: res.status };
        await new Promise((r) => setTimeout(r, 500));
        continue;
      }
      let body: { data?: T; errors?: GqlResult<T>["errors"] } = {};
      try { body = await res.json(); } catch { /* non-JSON body */ }
      return { data: body.data ?? undefined, errors: Array.isArray(body.errors) ? body.errors : undefined, status: res.status };
    } catch {
      last = { status: 0 };
    }
  }
  return last;
}
