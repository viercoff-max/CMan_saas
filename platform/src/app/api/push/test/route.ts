// "Enviar prueba": a notice to the signed-in person's own devices in the active business.
import { withSession, json } from "@/lib/channels/api";
import { checkSameOrigin } from "@/lib/security/origin";
import { hit } from "@/lib/security/rate-limit";
import { notifyTest } from "@/lib/push/notify";

export async function POST(req: Request) {
  const bad = checkSameOrigin(req); if (bad) return bad;
  return withSession(async (s) => {
    if (!(await hit(`push-test:${s.userId}`, 10, 60 * 60_000)).ok) return json({ error: "rate_limited" }, 429);
    const sent = await notifyTest(s.tenantId, s.userId);
    return json({ ok: true, sent });
  });
}
