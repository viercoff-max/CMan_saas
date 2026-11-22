// /channels UI (REVIEW-qa-2 P1-1, P1-4, P2-13/14; REVIEW-security-2 L7): server actions and the router are mocked.
import { describe, expect, it, vi } from "vitest";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
vi.mock("../actions", () => ({
  connectChannel: vi.fn(), connectManychat: vi.fn(), disconnectManychat: vi.fn(), rotateManychatToken: vi.fn(), connectTelegram: vi.fn(), disconnectChannel: vi.fn(), disconnectTelegram: vi.fn(), reregisterTelegramWebhook: vi.fn(),
}));

import { LocaleProvider } from "@/lib/i18n-client";
import { ChannelsClient, type AccountView, type ManychatView, type TelegramView, type WhatsAppView } from "../ChannelsClient";
import { whatsappPlatformReady } from "@/lib/platform/channels";
import { channelsDict } from "../dict";

const tgNoBot: TelegramView = { status: "disconnected", username: "", connectedAt: "", webhook: "failed", tokenHint: "", reachable: false, canEdit: true };
const meta = (status: AccountView["status"] = "disconnected"): AccountView[] =>
  (["whatsapp", "instagram", "messenger"] as const).map((channel) => ({ channel, status, name: status === "connected" ? "Mi página" : "", available: false }));
const render = (telegram: TelegramView, accounts: AccountView[], locale: "es" | "en" = "es", whatsapp?: WhatsAppView, manychat?: ManychatView) =>
  // children passed as the third argument (react/no-children-prop); the cast only satisfies LocaleProvider's prop type.
  renderToStaticMarkup(createElement(LocaleProvider, { locale } as { locale: typeof locale; children: ReactNode }, createElement(ChannelsClient, { telegram, accounts, whatsapp, manychat })));

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

  it("WhatsApp stays 'Próximamente' while the platform Meta app is not configured", () => {
    const html = render(tgNoBot, meta(), "es", { enabled: false, status: "disconnected", name: "", canEdit: true });
    expect(html).not.toContain(channelsDict.es["f.whatsapp.waba"]);
    expect(html.match(/Conectar y probar/g)).toHaveLength(1);
  });

  it("WhatsApp (beta) asks for phone number ID, WhatsApp Business account ID and token when the platform is ready", () => {
    const html = render(tgNoBot, meta(), "es", { enabled: true, status: "disconnected", name: "", canEdit: true });
    for (const k of ["f.whatsapp.id", "f.whatsapp.waba", "f.whatsapp.token", "wa.beta", "wa.window"]) expect(html).toContain(channelsDict.es[k].split("«")[0].slice(0, 30));
    expect(html.match(/Conectar y probar/g)).toHaveLength(2);
    expect(html).toMatch(/type="password"/); // the token field is masked
    expect(html).not.toMatch(/Token de verificación|Verify token|api\/webhooks\/meta/); // platform config never shown (L7)
  });

  it("WhatsApp: agents see the connection but no form", () => {
    const html = render(tgNoBot, meta(), "es", { enabled: true, status: "connected", name: "Mi Tienda", canEdit: false });
    expect(html).toContain("Mi Tienda");
    expect(html).toContain(channelsDict.es["wa.adminOnly"]);
    expect(html).not.toContain(channelsDict.es["f.whatsapp.waba"]);
  });

  it("whatsappPlatformReady needs both the app secret and the verify token", () => {
    expect(whatsappPlatformReady({})).toBe(false);
    expect(whatsappPlatformReady({ META_APP_SECRET: "x" })).toBe(false);
    expect(whatsappPlatformReady({ META_VERIFY_TOKEN: "y" })).toBe(false);
    expect(whatsappPlatformReady({ META_APP_SECRET: " ", META_VERIFY_TOKEN: "y" })).toBe(false);
    expect(whatsappPlatformReady({ META_APP_SECRET: "x", META_VERIFY_TOKEN: "y" })).toBe(true);
  });

  it("own-app WhatsApp: admins see the webhook URL + verify token to paste in Meta, the App Secret field and the paid-support offer", () => {
    const html = render(tgNoBot, meta(), "es", {
      enabled: true, platformReady: false, status: "connected", name: "Mi Tienda", canEdit: true, mode: "own_app", webhook: "pending",
      webhookUrl: "https://app.example/api/webhooks/whatsapp/abc", verifyToken: "VerifyTok123", supportEmail: "",
    });
    expect(html).toContain("https://app.example/api/webhooks/whatsapp/abc");
    expect(html).toContain("VerifyTok123");
    expect(html).toContain(channelsDict.es["wa.hook.pending"]);
    expect(html).toContain(channelsDict.es["f.whatsapp.secret"]);
    expect(html).toContain("costo adicional");
  });

  it("own-app WhatsApp: agents never see the verify token or webhook details", () => {
    const html = render(tgNoBot, meta(), "es", {
      enabled: true, status: "connected", name: "Mi Tienda", canEdit: false, mode: "own_app", webhook: "ok", webhookUrl: "", verifyToken: "",
    });
    expect(html).not.toContain(channelsDict.es["wa.hook.title"]);
    expect(html).not.toContain(channelsDict.es["f.whatsapp.secret"]);
  });

  it("Email is shown as coming soon (visual only: no form, no button)", () => {
    const html = render(tgNoBot, meta());
    expect(html).toContain(channelsDict.es["c.email"]);
    expect(html).toContain(channelsDict.es["email.soon"]);
    expect(html.match(/Conectar y probar/g)).toHaveLength(1);
  });

  it("ManyChat: admins see the key form; once connected, the endpoint, the Bearer token and the body to paste", () => {
    const off = render(tgNoBot, meta(), "es", undefined, { status: "disconnected", name: "", canEdit: true, endpointUrl: "", requestToken: "" });
    expect(off).toContain(channelsDict.es["mc.key"]);
    expect(off).not.toContain(channelsDict.es["mc.setup.title"]);
    const on = render(tgNoBot, meta(), "es", undefined, { status: "connected", name: "Mi Tienda MC", canEdit: true, endpointUrl: "https://app.example/api/integrations/manychat/abc", requestToken: "Tok123" });
    expect(on).toContain("https://app.example/api/integrations/manychat/abc");
    expect(on).toContain("Bearer Tok123");
    expect(on).toContain("subscriber_id");
    const agent = render(tgNoBot, meta(), "es", undefined, { status: "connected", name: "Mi Tienda MC", canEdit: false, endpointUrl: "", requestToken: "" });
    expect(agent).not.toContain("Bearer");
    expect(agent).toContain(channelsDict.es["mc.adminOnly"]);
  });
});
