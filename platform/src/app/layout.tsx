import type { Metadata } from "next";
import { Bricolage_Grotesque, Instrument_Sans, Martian_Mono } from "next/font/google";
import "./globals.css";
import { getLocale } from "@/lib/i18n";
import { PLATFORM_BRAND } from "@/lib/platform/brand";
import { NOINDEX } from "@/lib/platform/seo";

// Product identity from the platform brand config (lib/platform/brand.ts), never hard-coded. The app shell and the
// auth screens are private: noindex by default (public pages set their own robots via publicMetadata).
export const metadata: Metadata = {
  title: { default: PLATFORM_BRAND.name, template: `%s · ${PLATFORM_BRAND.name}` },
  description: "Soporte al cliente con IA: contesta las preguntas de siempre y pasa a tu equipo lo que necesita a una persona.",
  applicationName: PLATFORM_BRAND.name,
  robots: NOINDEX,
  // Installable app (phase 2): manifest from app/manifest.ts, icons in public/ (scripts/make-icons.mjs).
  icons: { icon: "/icon-192.png", apple: "/apple-touch-icon.png" },
  appleWebApp: { capable: true, title: PLATFORM_BRAND.name, statusBarStyle: "default" },
};

export const viewport = { themeColor: PLATFORM_BRAND.colors.primary };

// Platform typefaces, self-hosted by next/font at build time (the visitor's browser never calls Google).
// Display = headings and the wordmark, body = everything else, mono = times and states only (like a chat).
const display = Bricolage_Grotesque({ subsets: ["latin", "latin-ext"], variable: "--font-display", display: "swap" });
const body = Instrument_Sans({ subsets: ["latin", "latin-ext"], variable: "--font-body", display: "swap" });
const mono = Martian_Mono({ subsets: ["latin", "latin-ext"], variable: "--font-mono-ui", display: "swap" });

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
