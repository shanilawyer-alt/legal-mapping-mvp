import "server-only";
import { randomBytes, createHmac } from "node:crypto";
import { getEnv } from "@/lib/security/env";

/**
 * Secure random tokens, generic across the two credential types this app
 * issues:
 *   - the long-lived assessment access token (shown once, in the link an
 *     admin sends a client — see domain/assessment/service.ts)
 *   - the short-lived assessment session token (minted server-side when
 *     that link is first opened, carried afterward only in an HttpOnly
 *     cookie — see domain/assessment/session.ts)
 *
 * Both follow the same rule: the raw value is never persisted anywhere.
 * Only an HMAC-SHA256 digest (keyed by a server-side pepper) is stored, so
 * a stolen database export alone is not enough to forge or offline-brute-
 * force a valid credential without also having the pepper.
 */

const TOKEN_BYTES = 32; // 256 bits

export function generateSecureToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashSecureToken(rawToken: string): string {
  const { ASSESSMENT_TOKEN_PEPPER } = getEnv();
  return createHmac("sha256", ASSESSMENT_TOKEN_PEPPER)
    .update(rawToken, "utf8")
    .digest("hex");
}

export function isExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

export function addDays(days: number, from: Date = new Date()): Date {
  const result = new Date(from);
  result.setDate(result.getDate() + days);
  return result;
}

export function addHours(hours: number, from: Date = new Date()): Date {
  const result = new Date(from);
  result.setHours(result.getHours() + hours);
  return result;
}
