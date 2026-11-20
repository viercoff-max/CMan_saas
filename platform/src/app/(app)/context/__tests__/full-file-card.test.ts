// /context "Opción rápida": one file with the whole business context (general Data source).
import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("../../sources/actions", () => ({ deleteSourceAction: vi.fn() }));

import { LocaleProvider } from "@/lib/i18n-client";
import { dict } from "@/lib/context/dict";
import { FullFileCard, type FullFileInfo } from "../FullFileCard";

const render = (files: FullFileInfo[]) =>
  renderToStaticMarkup(createElement(LocaleProvider, { locale: "es" } as { locale: "es"; children: ReactNode }, createElement(FullFileCard, { files })));

describe("full context file card", () => {
  it("without a file: recommended, one upload button", () => {
    const html = render([]);
    expect(html).toContain(dict.es["full.title"]);
    expect(html).toContain(dict.es["full.recommended"]);
    expect(html).toContain(dict.es["full.choose"]);
    expect(html).not.toContain(dict.es["full.note"]);
  });

  it("with an indexed file: 'En uso', the file is listed and can be removed or another added", () => {
    const html = render([{ id: "s1", name: "catalogo-completo.pdf", status: "indexed", error: null }]);
    expect(html).toContain(dict.es["full.active"]);
    expect(html).toContain("catalogo-completo.pdf");
    expect(html).toContain(dict.es["full.addAnother"]);
    expect(html).toContain(dict.es["full.note"].slice(0, 30));
  });

  it("a file that could not be read is flagged and is not 'En uso'", () => {
    const html = render([{ id: "s1", name: "escaneo.pdf", status: "error", error: "empty" }]);
    expect(html).not.toContain(dict.es["full.active"]);
    expect(html).toContain(dict.es["src.status.error"]);
  });
});
