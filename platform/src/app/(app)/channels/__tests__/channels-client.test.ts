// /channels UI (REVIEW-qa-2 P1-1, P1-4, P2-13/14; REVIEW-security-2 L7): server actions and the router are mocked.
import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("../actions", () => ({
  connectTelegram: vi.fn(), disconnectChannel: vi.fn(), disconnectTelegram: vi.fn(), reregisterTelegramWebhook: vi.fn(),
}));

import { LocaleProvider } from "@/lib/i18n-client";
import { ChannelsClient, type AccountView, type TelegramView } from "../ChannelsClient";
import { channelsDict } from "../dict";

const tgNoBot: TelegramView = { status: "disconnected", username: "", connectedAt: "", webhook: "failed", tokenHint: "", reachable: false, canEdit: true };
const meta = (status: AccountView["status"] = "disconnected"): AccountView[] =>
  (["whatsapp", "instagram", "messenger"] as const).map((channel) => ({ channel, status, name: status === "connected" ? "Mi página" : "", available: false }));
const render = (telegram: TelegramView, accounts: AccountView[], locale: "es" | "en" = "es") =>
  // children passed as the third argument (react/no-children-prop); the cast only satisfies LocaleProvider's prop type.
  renderToStaticMarkup(createElement(LocaleProvider, { locale } as { locale: typeof locale; children: ReactNode }, createElement(ChannelsClient, { telegram, accounts })));

describe("channels page", () => {
  it("tenant with no bot: HTTPS note does not claim a saved bot nor point at a missing button", () => {
    const html = render(tgNoBot, meta());
    expect(html).toContain(channelsDict.es["tg.needsHttpsNoBot"]);
    expect(html).not.toContain("El bot quedó guardado");
    expect(html).not.toContain("Volver a registrar webhook");
  });

  it("connected bot with a failed webhook: the re-register button exists and is mentioned", () => {
    const html = render({ ...tgNoBot, status: "connected", username: "MiTiendaBot", webhook: "needs_https" }, meta());
    expect(html).toContain("Volver a registrar webhook");
  });

  it("WhatsApp, Instagram and Messenger are 'Próximamente' with no forms or connect buttons", () => {
    const html = render(tgNoBot, meta());
    expect(html.match(/Próximamente/g)?.length).toBeGreaterThanOrEqual(3);
    expect(html).not.toMatch(/>Conectar</);
    expect(html).not.toContain(channelsDict.es["f.whatsapp.id"]);
    // Exactly one primary action on the page: Telegram's "Conectar y probar".
    expect(html.match(/Conectar y probar/g)).toHaveLength(1);
  });

  it("never renders the platform's Meta verify token, webhook settings or repo paths (L7, P2-14)", () => {
    const html = render(tgNoBot, meta()) + render(tgNoBot, meta(), "en");
    expect(html).not.toMatch(/Token de verificación|Verify token|api\/webhooks\/meta|GO-LIVE/);
    for (const v of Object.values(channelsDict.es)) expect(v).not.toMatch(/docs\/|Chefman/);
  });

  it("a legacy Meta connection can still be removed", () => {
    const html = render(tgNoBot, meta("connected"));
    expect(html).toContain("Desconectar");
    expect(html).toContain("Mi página");
  });
});
