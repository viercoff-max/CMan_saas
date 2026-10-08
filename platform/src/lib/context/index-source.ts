// Indexes one source (link or uploaded file): extract text -> save content_text -> re-chunk. Never throws.
import fs from "node:fs/promises";
import { getSource, replaceChunks, updateSourceStatus } from "../store";
import { chunkText } from "./chunk";
import { extFromContentType, extOf, extractFromBuffer, googleExportUrl, htmlToText, MAX_UPLOAD_BYTES } from "./extract";
import { fetchSafe, UnsafeUrlError } from "./fetch-safe";
import { refreshSourceSections } from "./section-index";
import { resolveUploadPath } from "./upload-path";

export { resolveUploadPath };

const MAX_TEXT = 400_000;

/** Sections that use this source (as their file or as a linked source) are re-chunked from the new text. */
function refreshSections(tenantId: string, sourceId: string): void {
  try { refreshSourceSections(tenantId, sourceId); }
  catch (e) { console.error("[context] section refresh failed:", e instanceof Error ? e.message : "error"); }
}

function friendlyError(e: unknown): string {
  if (e instanceof UnsafeUrlError) {
    const m: Record<string, string> = {
      invalid_url: "invalid_url", bad_scheme: "bad_scheme", private_host: "private_host", dns_failed: "dns_failed",
      too_large: "too_large", timeout: "timeout", too_many_redirects: "too_many_redirects", credentials_in_url: "invalid_url",
    };
    if (e.code.startsWith("http_")) return e.code;
    return m[e.code] ?? "fetch_failed";
  }
  const msg = e instanceof Error ? e.message : "";
  if (msg === "unsupported_type" || msg === "empty" || msg === "file_missing" || msg === "file_too_large") return msg;
  return "extract_failed";
}

export type IndexResult = { ok: boolean; chunks: number; error?: string };

export async function indexSource(tenantId: string, sourceId: string): Promise<IndexResult> {
  const src = getSource(tenantId, sourceId);
  if (!src) return { ok: false, chunks: 0, error: "not_found" };
  try {
    let text = "";
    if (src.kind === "link") {
      if (!src.url) throw new Error("invalid_url");
      const g = googleExportUrl(src.url);
      const res = await fetchSafe(g ? g.url : src.url);
      const ext = g ? g.ext : extFromContentType(res.contentType, res.finalUrl);
      text = ext === "html" ? htmlToText(res.body.toString("utf8")) : await extractFromBuffer(res.body, ext);
      // Google sends a sign-in HTML page when the doc is not shared publicly.
      if (g && /<html|accounts\.google\.com/i.test(res.body.subarray(0, 2000).toString("utf8"))) throw new Error("google_private");
    } else {
      const full = src.filePath ? resolveUploadPath(tenantId, src.filePath) : null;
      if (!full) throw new Error("file_missing");
      const buf = await fs.readFile(full).catch(() => { throw new Error("file_missing"); });
      if (buf.length > MAX_UPLOAD_BYTES) throw new Error("file_too_large");
      text = await extractFromBuffer(buf, extOf(full));
    }
    text = text.slice(0, MAX_TEXT).trim();
    if (!text) throw new Error("empty");
    const chunks = chunkText(text, src.title);
    updateSourceStatus(tenantId, sourceId, "indexed", undefined, text);
    replaceChunks(tenantId, { sourceId }, chunks);
    refreshSections(tenantId, sourceId);
    return { ok: true, chunks: chunks.length };
  } catch (e) {
    const code = e instanceof Error && e.message === "google_private" ? "google_private" : friendlyError(e);
    updateSourceStatus(tenantId, sourceId, "error", code);
    refreshSections(tenantId, sourceId); // a section file that failed falls back to the typed text
    return { ok: false, chunks: 0, error: code };
  }
}
