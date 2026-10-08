// Cheap upload checks (REVIEW-security L2): declared MIME must fit the extension, and the bytes must look like it.
// Parsing limits (zip-bomb / huge PDF in a worker) are still a TODO for the context module.

// Browsers differ (Windows reports .csv as application/vnd.ms-excel; .md often has no type). "" and octet-stream are tolerated.
const MIME_BY_EXT: Record<string, string[]> = {
  pdf: ["application/pdf", "application/x-pdf"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document", "application/zip", "application/x-zip-compressed"],
  txt: ["text/plain"],
  md: ["text/markdown", "text/x-markdown", "text/plain"],
  csv: ["text/csv", "application/csv", "text/plain", "application/vnd.ms-excel", "text/x-csv"],
  html: ["text/html", "application/xhtml+xml"],
};
const LENIENT = new Set(["", "application/octet-stream"]);

export function mimeMatchesExt(mime: string, ext: string): boolean {
  const m = mime.split(";")[0].trim().toLowerCase();
  if (LENIENT.has(m)) return true;
  return (MIME_BY_EXT[ext] ?? []).includes(m);
}

/** Magic-byte sniff: PDF must start with %PDF- (within the first 1 KB), DOCX must be a zip, text types must not be binary. */
export function contentMatchesExt(head: Uint8Array, ext: string): boolean {
  const buf = Buffer.from(head.buffer, head.byteOffset, Math.min(head.byteLength, 8192));
  switch (ext) {
    case "pdf": return buf.subarray(0, 1024).includes("%PDF-");
    case "docx": return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
    case "txt": case "md": case "csv": case "html":
      return !buf.includes(0); // NUL byte => binary file renamed to .txt
    default: return false;
  }
}
