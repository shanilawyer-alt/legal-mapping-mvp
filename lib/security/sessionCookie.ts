/**
 * Shared constants/helpers for the assessment-session cookie (Phase 1.1
 * hardening — see domain/assessment/session.ts for the token-exchange
 * design this backs). Centralized so the cookie name and attributes are
 * defined once, not duplicated (and liable to drift) across the route
 * that sets it and the routes that read it.
 */

export const ASSESSMENT_SESSION_COOKIE = "assessment_session";

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    // Required even in local development: browsers accept `Secure` on
    // http://localhost as an exception, and this app is otherwise only
    // ever served over HTTPS. Never weaken this based on NODE_ENV.
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    expires: expiresAt,
  };
}
