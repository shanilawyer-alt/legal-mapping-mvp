import "server-only";
import type { Repositories } from "@/lib/db/repositories";
import { EDITABLE_ASSESSMENT_STATUSES, type Answer, type Assessment } from "@/lib/db/types";
import { addHours, generateSecureToken, hashSecureToken, isExpired } from "@/lib/security/token";
import { resolveAssessmentByToken, type AssessmentAccessError } from "@/domain/assessment/service";
import { loadQuestionnaire } from "@/domain/questionnaire/load";
import {
  normalizeAnswerValue,
  validateAnswerValue,
  type AnswerValidationError,
} from "@/domain/questionnaire/validate";

export type { AssessmentAccessError };

/**
 * Phase 1.1 hardening: the token-exchange flow.
 *
 * The long-lived assessment access token (domain/assessment/service.ts)
 * exists to be emailed/shared as a link and should not have to keep
 * traveling in the browser's address bar, history, or referrer headers for
 * the whole time a client is filling out the questionnaire — that's a lot
 * of exposure surface for a single credential that's valid for up to 30
 * days.
 *
 * So the token is used exactly once, to mint a much shorter-lived SESSION
 * (this module), carried afterward only in an HttpOnly cookie
 * (app/(public)/assessment/[token]/route.ts sets it; every subsequent
 * request reads it server-side, never from client-readable JS or the
 * URL). The session token follows the exact same rule as the assessment
 * token: only its HMAC-SHA256 hash is ever persisted (assessment_sessions
 * .session_token_hash), never the raw value.
 *
 * A session can never outlive its parent assessment token, and is capped
 * at SESSION_LIFETIME_HOURS regardless. If a session expires mid-
 * questionnaire, the client re-opens their original link, which mints a
 * fresh session — the underlying assessment token is unaffected.
 */

const SESSION_LIFETIME_HOURS = 24;

export type CreateSessionResult =
  | { ok: true; assessment: Assessment; rawSessionToken: string; sessionExpiresAt: Date }
  | { ok: false; error: AssessmentAccessError };

export async function createSessionForToken(
  repos: Repositories,
  rawToken: string,
): Promise<CreateSessionResult> {
  const resolved = await resolveAssessmentByToken(repos, rawToken);
  if (!resolved.ok) return resolved;

  const rawSessionToken = generateSecureToken();
  const sessionTokenHash = hashSecureToken(rawSessionToken);
  const tokenExpiresAt = new Date(resolved.assessment.tokenExpiresAt);
  const proposedExpiry = addHours(SESSION_LIFETIME_HOURS);
  // A session must never outlive the assessment token it was minted from.
  const sessionExpiresAt = proposedExpiry < tokenExpiresAt ? proposedExpiry : tokenExpiresAt;

  await repos.assessmentSessions.create({
    assessmentId: resolved.assessment.id,
    sessionTokenHash,
    expiresAt: sessionExpiresAt,
  });

  await repos.audit.record({
    actorType: "client",
    assessmentId: resolved.assessment.id,
    eventType: "session_created",
  });

  return { ok: true, assessment: resolved.assessment, rawSessionToken, sessionExpiresAt };
}

export type ResolveSessionResult =
  | { ok: true; assessment: Assessment }
  | { ok: false; error: AssessmentAccessError };

/**
 * The session-based counterpart to resolveAssessmentByToken — the same
 * isolation boundary, keyed by a session token instead of the original
 * assessment token. Every session-scoped operation below (and every public
 * API route from Phase 1.1 onward) goes through this rather than accepting
 * an assessmentId from the caller.
 */
export async function resolveAssessmentBySessionToken(
  repos: Repositories,
  rawSessionToken: string,
): Promise<ResolveSessionResult> {
  const hash = hashSecureToken(rawSessionToken);
  const session = await repos.assessmentSessions.findByTokenHash(hash);
  if (!session) return { ok: false, error: "not_found" };
  if (isExpired(new Date(session.expiresAt))) return { ok: false, error: "expired" };

  const assessment = await repos.assessments.getById(session.assessmentId);
  // The assessment being gone while a session for it still exists isn't
  // expected in normal operation, but fail closed rather than throw.
  if (!assessment) return { ok: false, error: "not_found" };

  return { ok: true, assessment };
}

export type EditableCheckResult = { ok: true } | { ok: false; error: "locked" };

/**
 * Only a DRAFT assessment accepts client writes (answers or documents) —
 * see lib/db/types.ts EDITABLE_ASSESSMENT_STATUSES and OPEN_QUESTIONS.md
 * item 11. Once submitted, the client sees a read-only confirmation view
 * (app/(public)/assessment) until an attorney explicitly reopens it
 * (domain/assessment/submission.ts reopenAssessment). Shared by
 * submitAnswerForSession below and domain/documents/service.ts.
 */
export function assertAssessmentEditable(assessment: Assessment): EditableCheckResult {
  if (!EDITABLE_ASSESSMENT_STATUSES.includes(assessment.status)) {
    return { ok: false, error: "locked" };
  }
  return { ok: true };
}

export type AnswersResult =
  | { ok: true; answers: Answer[] }
  | { ok: false; error: AssessmentAccessError };

export async function getAnswersForSession(
  repos: Repositories,
  rawSessionToken: string,
): Promise<AnswersResult> {
  const resolved = await resolveAssessmentBySessionToken(repos, rawSessionToken);
  if (!resolved.ok) return resolved;
  const answers = await repos.answers.listByAssessment(resolved.assessment.id);
  return { ok: true, answers };
}

export type SubmitAnswerResult =
  | { ok: true; answer: Answer }
  | { ok: false; error: AssessmentAccessError }
  | { ok: false; error: "locked" }
  | { ok: false; error: "unknown_question" }
  | { ok: false; error: "invalid_answer"; validationError: AnswerValidationError };

/**
 * Validates a client-submitted answer against `questionnaire.csv`'s
 * configured answer type/options (Phase 2 spec item 9) before it is ever
 * persisted — see domain/questionnaire/validate.ts. A questionId that
 * does not exist in the questionnaire at all is rejected outright rather
 * than silently stored, since nothing downstream could make sense of it.
 */
export async function submitAnswerForSession(
  repos: Repositories,
  rawSessionToken: string,
  questionId: string,
  valueJson: unknown,
): Promise<SubmitAnswerResult> {
  const resolved = await resolveAssessmentBySessionToken(repos, rawSessionToken);
  if (!resolved.ok) return resolved;

  const editable = assertAssessmentEditable(resolved.assessment);
  if (!editable.ok) return editable;

  const item = loadQuestionnaire().find((q) => q.id === questionId);
  if (!item) return { ok: false, error: "unknown_question" };

  const normalizedValue = normalizeAnswerValue(item, valueJson);
  const validation = validateAnswerValue(item, normalizedValue);
  if (!validation.ok) {
    return { ok: false, error: "invalid_answer", validationError: validation.error };
  }

  const answer = await repos.answers.upsert(
    resolved.assessment.id,
    questionId,
    normalizedValue,
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
