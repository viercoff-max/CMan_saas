// M2 (REVIEW-security-2): app-level throttling of the Supabase Auth flows. Every Auth call is made SERVER-side, so
// Supabase's own per-IP limits only see this server's egress IPs: without this an attacker could exhaust them
// (platform-wide sign-in / sign-up / reset DoS), guess passwords and mail-bomb addresses. Limits are per client IP
// (lib/security/client-ip.ts, trusted proxy headers only) AND per e-mail; keys are HMAC-hashed (never raw IPs or
// e-mails in storage). Storage: getData().rateLimits (SQLite or the rate_limit_hit RPC). A limited request gets the
// SAME generic answer as a normal one, so the limiter never reveals whether an account exists.
// Supabase CAPTCHA (Turnstile / hCaptcha) is the second layer: see docs/REVIEW-security-2.md "Fix status" (M2).
import {
  clearLoginFailures, countLoginFailures, hashKey, hit, recordLoginFailure, LOGIN_WINDOW_MS,
} from "../security/rate-limit";

export type AuthFlow = "signin" | "signup" | "reset";

const MIN = 60_000;
/** Attempts per fixed window (every call, successful or not). */
export const AUTH_LIMITS: Record<AuthFlow, { perIp: number; perEmail: number; windowMs: number }> = {
  signin: { perIp: 30, perEmail: 10, windowMs: 15 * MIN },
  signup: { perIp: 10, perEmail: 3, windowMs: 60 * MIN },
  reset: { perIp: 10, perEmail: 3, windowMs: 60 * MIN },
};
/** Sign-in FAILURES (sliding LOGIN_WINDOW_MS = 15 min): then every attempt is refused until the window passes. */
export const SIGNIN_MAX_FAILS_PER_EMAIL = 5;
export const SIGNIN_MAX_FAILS_PER_IP = 20;

const keys = (flow: AuthFlow | "signin-fail", ip: string, email: string) => ({
  ip: hashKey(`sb-${flow}-ip`, ip || "unknown"),
  email: hashKey(`sb-${flow}-email`, email),
});

/**
 * True when this attempt may reach Supabase Auth. Counts the attempt (both keys are always hit, so a blocked IP
 * cannot keep probing other e-mails for free). `email` must already be normalised (trimmed, lowercase).
 */
export async function authAttemptAllowed(flow: AuthFlow, ip: string, email: string, now = Date.now()): Promise<boolean> {
  const l = AUTH_LIMITS[flow];
  const k = keys(flow, ip, email);
  const [a, b] = await Promise.all([hit(k.ip, l.perIp, l.windowMs, now), hit(k.email, l.perEmail, l.windowMs, now)]);
  if (!a.ok || !b.ok) return false;
  if (flow !== "signin") return true;
  const f = keys("signin-fail", ip, email);
  const [fe, fi] = await Promise.all([countLoginFailures(f.email, now), countLoginFailures(f.ip, now)]);
  return fe < SIGNIN_MAX_FAILS_PER_EMAIL && fi < SIGNIN_MAX_FAILS_PER_IP;
}

export async function recordSignInFailure(ip: string, email: string, now = Date.now()): Promise<void> {
  const f = keys("signin-fail", ip, email);
  await recordLoginFailure([f.email, f.ip], now);
}

/** A successful sign-in clears the e-mail's failure counter (the IP counter keeps its window). */
export async function clearSignInFailures(email: string): Promise<void> {
  await clearLoginFailures(keys("signin-fail", "", email).email);
}

export { LOGIN_WINDOW_MS as SIGNIN_FAILURE_WINDOW_MS };
