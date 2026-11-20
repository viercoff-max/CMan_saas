// Handoff "outbox" files (email-like text written by lib/channels/handoff.ts until real email is wired), read and
// deleted by lib/retention. They contain customer messages (emails masked), so they follow the retention rules.
//   local (DATA_BACKEND=sqlite): DATA_DIR/outbox/<ts>-<conversationId>.txt (flat, unchanged), plus the legacy
//                                process.cwd()/data/outbox folder of older builds (purged too).
//   supabase:                    the private "tenant-files" bucket, "<tenantId>/outbox/<ts>-<conversationId>.txt",
//                                through the FileStore (serverless instances have no persistent disk).
// NOTE: relative imports only (the CLI scripts load src/lib with Node's type stripping).
import fs from "node:fs";
import path from "node:path";
import { OUTBOX_DIR } from "../db";
import { getFileStore, storageBackend } from "./index";

const PREFIX = "outbox";
const fileName = (conversationId: string, at: Date) =>
  `${at.toISOString().replace(/[:.]/g, "-")}-${String(conversationId).replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80)}.txt`;

/** Outbox folders (local mode): DATA_DIR/outbox, plus the legacy process.cwd()/data/outbox used by older builds. */
export function outboxDirs(): string[] {
  // turbopackIgnore: runtime data folders, not project files to trace into the server bundle.
  return [...new Set([OUTBOX_DIR, path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "outbox")].map((d) => path.resolve(/*turbopackIgnore: true*/ d)))];
}
function listLocal(): string[] {
  const out: string[] = [];
  for (const dir of outboxDirs()) {
    let names: string[] = [];
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const n of names) if (n.endsWith(".txt")) out.push(path.join(dir, n));
  }
  return out;
}
function rmLocal(file: string): boolean {
  try { fs.unlinkSync(file); return true; } catch { return false; }
}
const mentions = (text: string, convIds: string[], needles: string[]) =>
  convIds.some((id) => text.includes(id)) || needles.some((s) => s.length >= 4 && text.includes(s));

/** Writes one handoff file and returns its name. Throws on storage failure (the caller logs without details). */
export async function writeOutboxFile(tenantId: string, conversationId: string, text: string, at: Date = new Date()): Promise<string> {
  const name = fileName(conversationId, at);
  if (storageBackend() === "supabase") {
    await getFileStore().put(tenantId, `${PREFIX}/${name}`, new TextEncoder().encode(text), "text/plain");
    return name;
  }
  await fs.promises.mkdir(OUTBOX_DIR, { recursive: true });
  await fs.promises.writeFile(path.join(OUTBOX_DIR, name), text, "utf8");
  return name;
}

/**
 * Deletes the outbox files of these conversations (file name ends with -<convId>.txt, or the text mentions a
 * conversation id or one of `needles` of 4+ chars). Returns how many were deleted.
 */
export async function deleteOutboxFor(tenantId: string, convIds: string[], needles: string[] = []): Promise<number> {
  if (!convIds.length && !needles.length) return 0;
  let n = 0;
  if (storageBackend() === "supabase") {
    const store = getFileStore();
    for (const f of await store.list(tenantId, PREFIX)) {
      let hit = convIds.some((id) => f.key.endsWith(`-${id}.txt`));
      if (!hit) {
        const bytes = await store.get(tenantId, f.key);
        hit = !!bytes && mentions(new TextDecoder().decode(bytes), convIds, needles);
      }
      if (hit) { await store.remove(tenantId, f.key); n++; }
    }
    return n;
  }
  for (const f of listLocal()) {
    const base = path.basename(f);
    let hit = convIds.some((id) => base.endsWith(`-${id}.txt`));
    if (!hit) {
      let text = "";
      try { text = fs.readFileSync(f, "utf8"); } catch { continue; }
      hit = mentions(text, convIds, needles);
    }
    if (hit && rmLocal(f)) n++;
  }
  return n;
}

/** Deletes outbox files last written before `beforeMs` (local: every outbox folder; Supabase: these tenants). */
export async function purgeOutboxBefore(tenantIds: string[], beforeMs: number): Promise<number> {
  let n = 0;
  if (storageBackend() === "supabase") {
    const store = getFileStore();
    for (const t of tenantIds) {
      for (const f of await store.list(t, PREFIX)) {
        const at = f.updatedAt ? Date.parse(f.updatedAt) : NaN;
        if (Number.isFinite(at) && at < beforeMs) { await store.remove(t, f.key); n++; }
      }
    }
    return n;
  }
  for (const f of listLocal()) {
    try { if (fs.statSync(f).mtimeMs < beforeMs && rmLocal(f)) n++; } catch { /* ignore */ }
  }
  return n;
}
