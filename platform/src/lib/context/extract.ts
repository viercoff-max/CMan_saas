// Text extraction: HTML -> readable text, pdf/docx/plain files, Google Docs/Sheets export URLs. Server only.
export const ALLOWED_EXT = ["pdf", "docx", "txt", "md", "csv", "html"] as const;
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

const ENT: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  aacute: "á", eacute: "é", iacute: "í", oacute: "ó", uacute: "ú", ntilde: "ñ",
  Aacute: "Á", Eacute: "É", Iacute: "Í", Oacute: "Ó", Uacute: "Ú", Ntilde: "Ñ",
  iexcl: "¡", iquest: "¿",
};
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const n = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENT[e] ?? ENT[e.toLowerCase()] ?? m;
  });
}

export function htmlToText(html: string): string {
  let s = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|head|template|iframe)\b[\s\S]*?<\/\1>/gi, " ");
  s = s.replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, l: string, inner: string) => `\n\n${"#".repeat(Number(l))} ${inner.replace(/<[^>]+>/g, " ")}\n\n`);
  s = s.replace(/<li\b[^>]*>/gi, "\n- ")
    .replace(/<\/(p|div|section|article|tr|ul|ol|table|blockquote|header|footer|main)>/gi, "\n\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(td|th)>/gi, " | ")
    .replace(/<[^>]+>/g, " ");
  s = decodeEntities(s);
  return s.split("\n").map((l) => l.replace(/[ \t ]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

export function extOf(name: string): string {
  const m = /\.([a-z0-9]+)$/i.exec(name);
  return m ? m[1].toLowerCase() : "";
}

export async function extractFromBuffer(buf: Buffer, ext: string): Promise<string> {
  switch (ext) {
    case "pdf": {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(new Uint8Array(buf));
      const { text } = await extractText(pdf, { mergePages: true });
      return (Array.isArray(text) ? text.join("\n\n") : text).trim();
    }
    case "docx": {
      const mammoth = await import("mammoth");
      const r = await mammoth.extractRawText({ buffer: buf });
      return r.value.trim();
    }
    case "html":
    case "htm":
      return htmlToText(buf.toString("utf8"));
    case "txt": case "md": case "csv":
      return buf.toString("utf8").replace(/^﻿/, "").trim();
    default:
      throw new Error("unsupported_type");
  }
}

/** Decide extension from a response content-type / URL. */
export function extFromContentType(ct: string, url: string): string {
  const c = ct.toLowerCase();
  if (c.includes("pdf")) return "pdf";
  if (c.includes("wordprocessingml")) return "docx";
  if (c.includes("csv")) return "csv";
  if (c.includes("text/plain") || c.includes("markdown")) return "txt";
  if (c.includes("html") || c.includes("xml")) return "html";
  const e = extOf(new URL(url).pathname);
  return (ALLOWED_EXT as readonly string[]).includes(e) ? e : "html";
}

/** Google Docs/Sheets share link -> export URL (needs "anyone with the link"). */
export function googleExportUrl(raw: string): { url: string; ext: "txt" | "csv" } | null {
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.hostname !== "docs.google.com") return null;
  const doc = /^\/document\/d\/([\w-]+)/.exec(u.pathname);
  if (doc) return { url: `https://docs.google.com/document/d/${doc[1]}/export?format=txt`, ext: "txt" };
  const sheet = /^\/spreadsheets\/d\/([\w-]+)/.exec(u.pathname);
  if (sheet) {
    const gid = u.searchParams.get("gid") ?? /gid=(\d+)/.exec(u.hash)?.[1];
    return { url: `https://docs.google.com/spreadsheets/d/${sheet[1]}/export?format=csv${gid && /^\d+$/.test(gid) ? `&gid=${gid}` : ""}`, ext: "csv" };
  }
  return null;
}
