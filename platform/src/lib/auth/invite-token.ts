// Invitation tokens. Only the SHA-256 hash is stored (public.invitations.token_hash); the plain token exists once,
// in the accept link the admin copies. public.accept_invitation(p_token) hashes with
// encode(extensions.digest(p_token, 'sha256'), 'hex'), so this must stay lowercase hex over the UTF-8 token.
import { createHash, randomBytes } from "node:crypto";

export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** 32 random bytes, base64url (43 chars, URL-safe). */
export function newInviteToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, hash: hashInviteToken(token) };
}

/** Shape check before calling the RPC (avoids sending junk to the database). */
export function looksLikeInviteToken(t: unknown): t is string {
  return typeof t === "string" && /^[A-Za-z0-9_-]{32,128}$/.test(t);
}
