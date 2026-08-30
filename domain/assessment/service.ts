import "server-only";
import type { Repositories } from "@/lib/db/repositories";
import type { Assessment } from "@/lib/db/types";
import { addDays, generateSecureToken, hashSecureToken, isExpired } from "@/lib/security/token";

/**
 * The assessment access token: created once by an admin
 * (`createAssessmentWithToken`) and shown to them exactly once, to send to
 * the client. `resolveAssessmentByToken` is used exactly once per token,
 * by the token-exchange endpoint (app/(public)/assessment/[token]/route.ts)
 * — it is NOT how the ongoing questionnaire session authenticates.
 *
 * For everything after that first exchange (reading/writing answers,
 * uploading documents), see domain/assessment/session.ts — the
 * short-lived session it mints is what public API routes actually check.
 * This split is Phase 1.1 hardening: the long-lived token no longer has to
 * travel in the browser URL or be resent on every request.
 */

export type AssessmentAccessError = "not_found" | "expired";

export interface CreateAssessmentInput {
  organizationId: string;
  expiryDays?: number;
}

export interface CreateAssessmentResult {
  assessment: Assessment;
  /** Shown to the caller exactly once. Never persisted or logged. */
  rawToken: string;
}

export async function createAssessmentWithToken(
  repos: Repositories,
  input: CreateAssessmentInput,
  actorId: string,
): Promise<CreateAssessmentResult> {
  const rawToken = generateSecureToken();
  const secureTokenHash = hashSecureToken(rawToken);

  const assessment = await repos.assessments.create({
    organizationId: input.organizationId,
    secureTokenHash,
    tokenExpiresAt: addDays(input.expiryDays ?? 30),
    assessmentVersion: "V1",
    questionnaireVersion: "V1",
    ruleEngineVersion: "V1",
  });

  await repos.audit.record({
    actorType: "admin",
    actorId,
    assessmentId: assessment.id,
    eventType: "link_created",
  });

  return { assessment, rawToken };
}

export type ResolveResult =
  | { ok: true; assessment: Assessment }
  | { ok: false; error: AssessmentAccessError };

export async function resolveAssessmentByToken(
  repos: Repositories,
  rawToken: string,
): Promise<ResolveResult> {
  const hash = hashSecureToken(rawToken);
  const assessment = await repos.assessments.findByTokenHash(hash);
  if (!assessment) return { ok: false, error: "not_found" };
  if (isExpired(new Date(assessment.tokenExpiresAt))) {
    return { ok: false, error: "expired" };
  }
  return { ok: true, assessment };
}
