// Test fixtures: connect an add-on / channel account with secrets in one call, the way the app's routes do it
// (status row + secrets sub-repo). Not a test file itself (no .test.ts suffix).
import { getData } from "..";
import type { AddonKey, ChannelAccount } from "../../types";

type Save = { status: "connected" | "disconnected" | "error"; secrets?: unknown; publicInfo?: Record<string, unknown> };

export async function saveAddonForTest(tenantId: string, key: AddonKey, v: Save): Promise<void> {
  const data = getData();
  if (v.secrets !== undefined) await data.secrets.set(tenantId, "addon", key, v.secrets);
  await data.addons.save(tenantId, key, { status: v.status, publicInfo: v.publicInfo });
}

export async function saveChannelForTest(tenantId: string, channel: ChannelAccount["channel"], v: Save): Promise<void> {
  const data = getData();
  await data.channels.save(tenantId, channel, { status: v.status, publicInfo: v.publicInfo });
  if (v.secrets !== undefined) await data.secrets.set(tenantId, "channel", channel, v.secrets);
}
