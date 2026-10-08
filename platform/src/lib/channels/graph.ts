// Single place to pin the Meta Graph API version and hosts (checked against developers.facebook.com, 2026-10).
// v25.0 is used in the current Messenger, Instagram and WhatsApp doc examples and is supported until July 2028.
// Bump it here only (all sends, credential checks and tests read these constants).
export const GRAPH_API_VERSION = "v25.0";

/** Facebook Graph host: WhatsApp Cloud API, Messenger, and Instagram messaging through a Facebook Page token. */
export const FB_GRAPH = `https://graph.facebook.com/${GRAPH_API_VERSION}`;
/** Instagram Graph host: only for "Instagram API with Instagram Login" tokens (they start with "IG"). */
export const IG_GRAPH = `https://graph.instagram.com/${GRAPH_API_VERSION}`;

/**
 * Instagram user tokens from "Business Login for Instagram" start with "IG" (e.g. IGAA...) and only work on
 * graph.instagram.com. Page tokens (Facebook Login / system user) start with "EAA" and work on graph.facebook.com.
 */
export const isInstagramLoginToken = (token: string | undefined | null) => /^IG/.test(String(token ?? ""));

/** Fields the app subscribes to on a Page (Messenger and Instagram-through-Page) or on an IG Login account. */
export const MESSAGING_SUBSCRIBED_FIELDS = "messages,messaging_postbacks";
