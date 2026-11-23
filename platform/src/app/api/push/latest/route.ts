// The service worker calls this when an (empty) push arrives, with the person's own session cookie, to get the
// notice text. Only the signed-in person's notices of the last 15 minutes; nothing about customers is included.
import { withSession, json } from "@/lib/channels/api";
import { getData } from "@/lib/data";

export async function GET() {
  return withSession(async (s) => {
    const since = new Date(Date.now() - 15 * 60_000).toISOString();
    const [n] = await getData().push.latestNotices(s.userId, since, 1);
    if (!n) return json({ notice: null });
    return json({ notice: { title: n.title, body: n.body, url: n.url, kind: n.kind, id: n.id } });
  });
}
