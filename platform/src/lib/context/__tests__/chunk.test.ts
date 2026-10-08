import { describe, expect, it } from "vitest";
import { chunkText } from "../chunk";
import { googleExportUrl, htmlToText } from "../extract";

describe("chunkText", () => {
  it("returns nothing for empty input", () => {
    expect(chunkText("   \n ")).toEqual([]);
  });
  it("keeps short text as one chunk with the title", () => {
    const c = chunkText("Garantía de 1 año.", "Garantía");
    expect(c).toEqual([{ title: "Garantía", text: "Garantía de 1 año." }]);
  });
  it("packs paragraphs up to ~900 chars and never exceeds the max", () => {
    const para = "Lorem ipsum dolor sit amet. ".repeat(10).trim(); // ~280 chars
    const text = Array.from({ length: 12 }, () => para).join("\n\n");
    const chunks = chunkText(text, "T");
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(900);
    expect(chunks[0].text.length).toBeGreaterThan(500);
  });
  it("splits a huge paragraph by sentences / hard limit", () => {
    const chunks = chunkText("A".repeat(3000), "T");
    expect(chunks.length).toBe(4);
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(900);
    const sent = chunkText("Una frase corta. ".repeat(200), "T");
    for (const c of sent) expect(c.text.length).toBeLessThanOrEqual(900);
  });
  it("starts a new chunk at headings and appends the heading to the title", () => {
    const chunks = chunkText("# Envíos\n\nTres a siete días.\n\n## Devoluciones\n\n30 días.", "Políticas");
    expect(chunks.map((c) => c.title)).toEqual(["Políticas - Envíos", "Políticas - Devoluciones"]);
    expect(chunks[0].text).toBe("Tres a siete días.");
  });
  it("handles CRLF", () => {
    expect(chunkText("a\r\n\r\nb", "T")).toHaveLength(1);
  });
});

describe("extract helpers", () => {
  it("strips scripts and tags, keeps headings", () => {
    const t = htmlToText("<html><head><title>x</title></head><body><script>evil()</script><h1>Hola</h1><p>Mundo &amp; m&aacute;s</p></body></html>");
    expect(t).toContain("# Hola");
    expect(t).toContain("Mundo & más");
    expect(t).not.toContain("evil");
  });
  it("maps Google Docs and Sheets share links to export urls", () => {
    expect(googleExportUrl("https://docs.google.com/document/d/abc_123-X/edit?usp=sharing")).toEqual({
      url: "https://docs.google.com/document/d/abc_123-X/export?format=txt", ext: "txt",
    });
    expect(googleExportUrl("https://docs.google.com/spreadsheets/d/SHEET1/edit#gid=42")?.url).toBe(
      "https://docs.google.com/spreadsheets/d/SHEET1/export?format=csv&gid=42",
    );
    expect(googleExportUrl("https://evil.com/document/d/abc")).toBeNull();
  });
});
