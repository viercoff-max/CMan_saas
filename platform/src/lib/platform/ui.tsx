// Platform (not tenant) identity bits shared by the public site and /platform. Server components only.
import type { Locale } from "../i18n-shared";
import { PLATFORM_BRAND } from "./brand";

/** Inline CSS variables so these areas keep the platform colours whatever a tenant theme does to globals. */
export const platformThemeStyle = {
  "--brand": PLATFORM_BRAND.colors.primary,
  "--brand-dark": PLATFORM_BRAND.colors.primaryDark,
  "--on-brand": "#ffffff",
} as React.CSSProperties;

export function PlatformLogo({ size = 32 }: { size?: number }) {
  const c = PLATFORM_BRAND.colors;
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden="true" focusable="false">
      <rect width="40" height="40" rx="11" fill="#14181F" />
      <path d="M10 13.5a4 4 0 0 1 4-4h9a4 4 0 0 1 4 4v5a4 4 0 0 1-4 4h-6l-4.5 3.6v-3.7A4 4 0 0 1 10 18.5z" fill={c.primary} />
      <path d="M18 23.5h7.5l4.5 3.6v-3.7a3.6 3.6 0 0 0 0-.4V18" fill="none" stroke="#fff" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

/** Logo + name + dashed "nombre provisional" chip. `dark` = on the deep teal header. */
export function PlatformWordmark({ locale, dark = false }: { locale: Locale; dark?: boolean }) {
  const b = PLATFORM_BRAND;
  return (
    <span className="inline-flex items-center gap-2.5">
      <PlatformLogo />
      <span className={`text-lg font-bold tracking-tight ${dark ? "text-white" : "text-ink"}`}>{b.name}</span>
      {b.provisional && (
        <span className={`hidden rounded-full border border-dashed px-2 py-0.5 text-xs sm:inline ${dark ? "border-white/40 text-white/80" : "border-line text-muted"}`}>
          {b.provisionalLabel[locale]}
        </span>
      )}
    </span>
  );
}
