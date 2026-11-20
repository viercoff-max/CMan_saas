// Per-page metadata for the public site and the platform-admin screen.
// Indexing is OFF while SITE_INDEXABLE is false (brand.ts); draft legal pages are always noindex.
import type { Metadata } from "next";
import { PLATFORM_BRAND, SITE_INDEXABLE } from "./brand";

export const NOINDEX: NonNullable<Metadata["robots"]> = {
  index: false, follow: false, nocache: true, googleBot: { index: false, follow: false },
};

// No canonical/metadataBase yet: the public domain is not decided (add `alternates.canonical` with it).
export function publicMetadata(o: { title: string; description: string; draft?: boolean }): Metadata {
  const indexable = SITE_INDEXABLE && !o.draft;
  return {
    title: { absolute: `${o.title} · ${PLATFORM_BRAND.name}` },
    description: o.description,
    robots: indexable ? { index: true, follow: true } : NOINDEX,
    openGraph: { title: o.title, description: o.description, siteName: PLATFORM_BRAND.name, type: "website" },
  };
}

/** /platform is private: never indexed, generic title (does not advertise what it is). */
export const platformAdminMetadata: Metadata = {
  title: { absolute: PLATFORM_BRAND.name },
  robots: NOINDEX,
};
