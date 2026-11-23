// Turn notices on / off for THIS device: { endpoint } from PushManager.subscribe. Only endpoints of the known browser
// push services are accepted (SSRF guard). Saved for the signed-in person in the ACTIVE business.
import { z } from "zod";
import { withSession, json } from "@/lib/channels/api";
import { checkSameOrigin } from "@/lib/security/origin";
import { getData } from "@/lib/data";
import { hit } from "@/lib/security/rate-limit";
import { isAllowedEndpoint, vapidKeys } from "@/lib/push/webpush";

const Body = z.object({ endpoint: z.string().max(1000) });

export async function GET() {
  return withSession(async () => json({ publicKey: vapidKeys().publicKey }));
}

export async function POST(req: Request) {
  const bad = checkSameOrigin(req); if (bad) return bad;
  return withSession(async (s) => {
    if (!(await hit(`push-sub:${s.userId}`, 30, 60 * 60_000)).ok) return json({ error: "rate_limited" }, 429);
    const p = Body.safeParse(await req.json().catch(() => null));
    if (!p.success || !isAllowedEndpoint(p.data.endpoint)) return json({ error: "invalid_endpoint" }, 400);
    const ua = (req.headers.get("user-agent") ?? "").slice(0, 200);
    await getData().push.subscribe(s.tenantId, s.userId, p.data.endpoint, ua);
    await getData().audit.log(s.tenantId, s.userId, "push.subscribe", "device");
    return json({ ok: true });
  });
}

export async function DELETE(req: Request) {
  const bad = checkSameOrigin(req); if (bad) return bad;
  return withSession(async (s) => {
    const p = Body.safeParse(await req.json().catch(() => null));
    if (!p.success) return json({ error: "invalid_endpoint" }, 400);
    const ok = await getData().push.unsubscribe(s.tenantId, s.userId, p.data.endpoint);
    return json({ ok });
  });
}
