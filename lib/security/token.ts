import "server-only";
import { randomBytes, createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/security/env";

/**
 * Assessment access tokens.
 *
 * The raw token is shown to the client exactly once (in the generated
 * link) and is NEVER persisted. Only an HMAC-SHA256 digest of the token
 * (keyed by a server-side pepper) is stored in `assessments.secure_token_hash`.
 * Using HMAC rather than a plain hash means a stolen database dump alone
 * is not enough to forge or brute-force a valid token offline without also
 * having the pepper.
 */

const TOKEN_BYTES = 32; // 256 bits

export function generateAssessmentToken(): string {
  return randomBytes(TOKEN_BYTES).toString("base64url");
}

export function hashAssessmentToken(rawToken: string): string {
  const { ASSESSMENT_TOKEN_PEPPER } = getEnv();
  return createHmac("sha256", ASSESSMENT_TOKEN_PEPPER)
    .update(rawToken, "utf8")
    .digest("hex");
}

/**
 * Constant-time comparison of two hex digests, so a lookup miss or a
 * near-match doesn't leak timing information about how close a guess was.
 * Repositories should still do the primary lookup with an indexed equality
 * query (WHERE secure_token_hash = $1); this is a defense-in-depth check
 * for any code path that compares hashes in application code.
 */
export function safeCompareHash(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function isTokenExpired(expiresAt: Date, now: Date = new Date()): boolean {
  return expiresAt.getTime() <= now.getTime();
}

export function defaultTokenExpiry(days = 30): Date {
  const expires = new Date();
  expires.setDate(expires.getDate() + days);
  return expires;
}
