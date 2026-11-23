import type { Metadata } from "next";
import "./globals.css";
import { getLocale } from "@/lib/i18n";
import { PLATFORM_BRAND } from "@/lib/platform/brand";
import { NOINDEX } from "@/lib/platform/seo";

// Product identity from the platform brand config (lib/platform/brand.ts), never hard-coded. The app shell and the
// auth screens are private: noindex by default (public pages set their own robots via publicMetadata).
export const metadata: Metadata = {
  title: { default: PLATFORM_BRAND.name, template: `%s · ${PLATFORM_BRAND.name}` },
  description: "Asistente que contesta a tus clientes en Telegram y pasa la conversación a una persona cuando hace falta.",
  applicationName: PLATFORM_BRAND.name,
  robots: NOINDEX,
  // Installable app (phase 2): manifest from app/manifest.ts, icons in public/ (scripts/make-icons.mjs).
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: PLATFORM_BRAND.name, statusBarStyle: "default" },
};

export const viewport = { themeColor: PLATFORM_BRAND.colors.primary };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
