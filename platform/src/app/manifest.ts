// Web app manifest: lets people install the platform on their phone / computer ("Agregar a pantalla de inicio")
// so notices arrive like an app's (iPhone needs the installed app for notices, iOS 16.4+).
import type { MetadataRoute } from "next";
import { PLATFORM_BRAND } from "@/lib/platform/brand";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: PLATFORM_BRAND.name,
    short_name: PLATFORM_BRAND.name,
    description: "Soporte al cliente con IA: atiende a tus clientes y recibe avisos cuando alguien necesita a una persona.",
    start_url: "/inbox",
    scope: "/",
    display: "standalone",
    background_color: "#F4F3FB",
    theme_color: PLATFORM_BRAND.colors.primary,
    lang: "es",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
