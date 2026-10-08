// Public API of the context module (server only).
import { CONTEXT_SECTION_KEYS } from "../types";
import { reindexSection } from "./section-index";

export { chunkText } from "./chunk";
export { indexSource } from "./index-source";
export { defaultGreeting, defaultFallback, parseBusinessHours, serializeBusinessHours, type BusinessHours } from "./settings";
/** Re-chunk one section into the chunks table (effective content: typed text or section file, plus linked sources). */
export { reindexSection, refreshSourceSections, restoreGeneralSourceChunks, deleteSourceAndLinks, deleteSourceRowAndLinks } from "./section-index";
export {
  getEffectiveSectionContent, isSectionFilled, ALWAYS_ON_SECTIONS, ALWAYS_ON_CAP, type EffectiveSection, type SectionMode,
} from "./section-repo";

/** Rebuild chunks for every context section of the tenant (e.g. after import or seed). */
export function reindexAllSections(tenantId: string): void {
  for (const key of CONTEXT_SECTION_KEYS) reindexSection(tenantId, key);
}

export { CONTEXT_SECTION_KEYS };
