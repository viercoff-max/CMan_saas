// Splits free text into retrieval chunks (~600-900 chars), keeping a title. Pure: no I/O.
export interface TextChunk { title: string; text: string }

const MAX = 900;
const TARGET_MIN = 600;

function splitLong(p: string, max: number): string[] {
  if (p.length <= max) return [p];
  const out: string[] = [];
  const sentences = p.match(/[^.!?\n]+[.!?]+["')\]]*\s*|[^.!?\n]+$/g) ?? [p];
  let buf = "";
  for (const s of sentences) {
    if (buf && (buf + s).length > max) { out.push(buf.trim()); buf = ""; }
    if (s.length > max) {
      for (let i = 0; i < s.length; i += max) out.push(s.slice(i, i + max).trim());
    } else buf += s;
  }
  if (buf.trim()) out.push(buf.trim());
  return out.filter(Boolean);
}

const headingRe = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/;

/** Split by headings and paragraphs; greedy-pack paragraphs up to ~900 chars. */
export function chunkText(input: string, baseTitle = "", opts: { max?: number; min?: number } = {}): TextChunk[] {
  const max = opts.max ?? MAX;
  const min = opts.min ?? TARGET_MIN;
  const text = (input ?? "").replace(/\r\n?/g, "\n").trim();
  if (!text) return [];

  const chunks: TextChunk[] = [];
  let heading = "";
  let buf = "";
  const titleOf = () => [baseTitle, heading].filter(Boolean).join(" - ");
  const flush = () => {
    const t = buf.trim();
    if (t) chunks.push({ title: titleOf(), text: t });
    buf = "";
  };

  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split("\n");
    let rest: string[] = lines;
    const m = headingRe.exec(lines[0]);
    if (m) {
      flush();
      heading = m[1].trim();
      rest = lines.slice(1);
    }
    const para = rest.join("\n").trim();
    if (!para) continue;
    for (const piece of splitLong(para, max)) {
      if (buf && buf.length + piece.length + 2 > max) flush();
      buf += (buf ? "\n\n" : "") + piece;
      if (buf.length >= min && buf.length + 1 >= max) flush();
    }
  }
  flush();
  return chunks;
}
