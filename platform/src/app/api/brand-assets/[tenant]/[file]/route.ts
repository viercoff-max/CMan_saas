// Public brand logos in LOCAL mode (DATA_BACKEND=sqlite): GET /api/brand-assets/<tenantId>/logo-<uuid>.<png|jpg|webp>.
// The local twin of the public "brand-assets" Supabase bucket (in Supabase mode logos are served by Supabase itself,
// so this route answers 404). Only server-written logo names are served, with their real type and nosniff.
import { getFileStore, storageBackend } from "@/lib/storage";

export const runtime = "nodejs";

const TENANT = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const FILE = /^logo-[0-9a-f-]{36}\.(png|jpg|webp)$/;
const TYPES: Record<string, string> = { png: "image/png", jpg: "image/jpeg", webp: "image/webp" };

const notFound = () => new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(_req: Request, ctx: { params: Promise<{ tenant: string; file: string }> }) {
  if (storageBackend() !== "local") return notFound();
  const { tenant, file } = await ctx.params;
  const m = FILE.exec(file ?? "");
  if (!TENANT.test(tenant ?? "") || !m) return notFound();
  const bytes = await getFileStore("brand-assets").get(tenant, file).catch(() => null);
  if (!bytes) return notFound();
  return new Response(Buffer.from(bytes), {
    headers: {
      "Content-Type": TYPES[m[1]],
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
      // The name is random per upload, so it can be cached forever.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
