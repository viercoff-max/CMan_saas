import { InboxClient } from "./InboxClient";

export const dynamic = "force-dynamic";

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ c?: string; simulator?: string }> }) {
  const sp = await searchParams;
  return <InboxClient initialId={typeof sp.c === "string" ? sp.c : null} initialSimulator={sp.simulator === "1"} />;
}
