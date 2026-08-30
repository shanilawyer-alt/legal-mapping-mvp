import "server-only";
import type { Repositories } from "@/lib/db/repositories";
import type { Answer, Assessment } from "@/lib/db/types";
import {
  defaultTokenExpiry,
  generateAssessmentToken,
  hashAssessmentToken,
  isTokenExpired,
} from "@/lib/security/token";

/**
 * The token-isolation boundary (spec §2.1: "a client may access only her
 * assessment"). Every public/client-facing operation goes through
 * `resolveAssessmentByToken` first, which derives `assessmentId` from a
 * verified token. Public API routes must never accept an `assessmentId`
 * directly from the client — only a raw token — so there is no field a
 * malicious request could tamper with to reach a different assessment.
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
  const rawToken = generateAssessmentToken();
  const secureTokenHash = hashAssessmentToken(rawToken);

  const assessment = await repos.assessments.create({
    organizationId: input.organizationId,
    secureTokenHash,
    tokenExpiresAt: defaultTokenExpiry(input.expiryDays ?? 30),
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
  const hash = hashAssessmentToken(rawToken);
  const assessment = await repos.assessments.findByTokenHash(hash);
  if (!assessment) return { ok: false, error: "not_found" };
  if (isTokenExpired(new Date(assessment.tokenExpiresAt))) {
    return { ok: false, error: "expired" };
  }
  return { ok: true, assessment };
}

export type AnswersResult =
  | { ok: true; answers: Answer[] }
  | { ok: false; error: AssessmentAccessError };

export async function getAnswersForToken(
  repos: Repositories,
  rawToken: string,
): Promise<AnswersResult> {
  const resolved = await resolveAssessmentByToken(repos, rawToken);
  if (!resolved.ok) return resolved;
  const answers = await repos.answers.listByAssessment(resolved.assessment.id);
  return { ok: true, answers };
}

export type SubmitAnswerResult =
  | { ok: true; answer: Answer }
  | { ok: false; error: AssessmentAccessError };

export async function submitAnswerForToken(
  repos: Repositories,
  rawToken: string,
  questionId: string,
  valueJson: unknown,
): Promise<SubmitAnswerResult> {
  const resolved = await resolveAssessmentByToken(repos, rawToken);
  if (!resolved.ok) return resolved;

  const answer = await repos.answers.upsert(
    resolved.assessment.id,
    questionId,
    valueJson,
    "client",
  );

  await repos.audit.record({
    actorType: "client",
    assessmentId: resolved.assessment.id,
    eventType: "answer_submitted",
    metadata: { questionId },
  });

  return { ok: true, answer };
}
