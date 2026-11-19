// Absolute base URL for links in emails / invitations. PUBLIC_URL wins (set it in production); otherwise the request
// host. Supabase only follows redirect URLs on its allow list, so a spoofed Host cannot redirect an email link.
import { headers } from "next/headers";

export async function appBaseUrl(): Promise<string> {
  const pub = process.env.PUBLIC_URL?.trim();
  if (pub) return pub.replace(/\/+$/, "");
  const h = await headers();
  const host = h.get("x-forwarded-host")?.split(",")[0]?.trim() || h.get("host") || "localhost:3000";
  const proto = h.get("x-forwarded-proto")?.split(",")[0]?.trim() || (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}
