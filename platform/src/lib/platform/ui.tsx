// Platform (not tenant) identity bits shared by the public site, the sign-in screens and /platform. Server components only.
// Identity: "hola conversa" (design/landing-2026): the word "hola" in a buganvilia speech bubble, then "conversa".
import type { Locale } from "../i18n-shared";
import { PLATFORM_BRAND } from "./brand";

/**
 * Platform areas never sit inside a tenant's [data-brand] wrapper, so the :root tokens of globals.css (the platform
 * identity, light and dark) already apply. Kept as an explicit hook for those areas; it adds no override, so dark mode
 * keeps its own contrast-checked brand colours.
 */
export const platformThemeStyle = {} as React.CSSProperties;

/** Square app mark: buganvilia tile with a white bubble (same drawing as the installable-app icons). */
export function PlatformLogo({ size = 32 }: { size?: number }) {
  const c = PLATFORM_BRAND.colors;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true" focusable="false">
      <rect width="100" height="100" rx="26" fill={c.primary} />
      <path d="M32 24h36a12 12 0 0 1 12 12v20a12 12 0 0 1-12 12H46L30 82V68a12 12 0 0 1-10-12V36a12 12 0 0 1 12-12z" fill="#fff" />
      <circle cx="36" cy="46" r="4.5" fill={c.deep} /><circle cx="50" cy="46" r="4.5" fill={c.deep} /><circle cx="64" cy="46" r="4.5" fill={c.mango} />
    </svg>
  );
}

/** "hola" bubble + "conversa". `dark` = on a tinta band. `size` scales the whole wordmark (px of the text). */
export function PlatformWordmark({ locale, dark = false, size = 22 }: { locale: Locale; dark?: boolean; size?: number }) {
  const b = PLATFORM_BRAND;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="sr-only">{b.name}</span>
      <span aria-hidden="true" className="inline-flex items-center font-extrabold leading-none [font-family:var(--heading-font)]" style={{ fontSize: size, letterSpacing: "-0.03em", gap: "0.3em" }}>
        <span className="relative text-white" style={{ background: b.colors.primary, padding: "0.2em 0.45em 0.28em", borderRadius: "0.6em 0.6em 0.6em 0.16em" }}>
          hola
          <svg aria-hidden="true" focusable="false" viewBox="0 0 10 8" className="absolute" style={{ left: -1, bottom: "-0.3em", width: "0.45em", height: "0.36em" }}>
            <path d="M0 0h10L0 8z" fill={b.colors.primary} />
          </svg>
        </span>
        <span className={dark ? "text-white" : "text-ink"}>{b.name.toLowerCase()}</span>
      </span>
      {b.provisional && (
        <span className={`hidden rounded-full border border-dashed px-2 py-0.5 text-xs sm:inline ${dark ? "border-white/40 text-white/80" : "border-line text-muted"}`}>
          {b.provisionalLabel[locale]}
        </span>
      )}
    </span>
  );
}
