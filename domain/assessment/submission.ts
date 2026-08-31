import "server-only";
import type { Repositories } from "@/lib/db/repositories";
import type { Assessment } from "@/lib/db/types";
import type { AnswerMap, AnswerValue } from "@/domain/branching/evaluate";
import { loadQuestionnaire } from "@/domain/questionnaire/load";
import { computeEffectiveAnswers } from "@/domain/questionnaire/effective";
import {
  assertAssessmentEditable,
  resolveAssessmentBySessionToken,
  type AssessmentAccessError,
} from "@/domain/assessment/session";

/**
 * Phase 2 submission lifecycle: DRAFT -> SUBMITTED (client-initiated,
 * this module) and SUBMITTED -> DRAFT (attorney-initiated reopen, admin
 * side). See OPEN_QUESTIONS.md items 11, 12, 16, 18 for the schema and
 * policy decisions this builds on.
 */

export type SubmitAssessmentResult =
  | { ok: true; assessment: Assessment }
  | { ok: false; error: AssessmentAccessError }
  | { ok: false; error: "locked" }
  | { ok: false; error: "missing_required"; missingQuestionIds: readonly string[] };

/**
 * A core ("ליבה") question that is currently visible must be answered
 * before submission is allowed (OPEN_QUESTIONS.md item 12); a conditional
 * ("מותנה") question stays optional even when visible. Visibility and
 * "has an answer" are both decided from `computeEffectiveAnswers` (item
 * 18) — a stale answer to a now-hidden question never counts toward
 * satisfying a requirement, and a hidden question is never required.
 */
export async function submitAssessmentForSession(
  repos: Repositories,
  rawSessionToken: string,
): Promise<SubmitAssessmentResult> {
  const resolved = await resolveAssessmentBySessionToken(repos, rawSessionToken);
  if (!resolved.ok) return resolved;

  const editable = assertAssessmentEditable(resolved.assessment);
  if (!editable.ok) return editable;

  const rawAnswers = await repos.answers.listByAssessment(resolved.assessment.id);
  const rawAnswerMap: Record<string, AnswerValue> = {};
  for (const answer of rawAnswers) {
    rawAnswerMap[answer.questionId] = answer.valueJson as AnswerValue;
  }

  const items = loadQuestionnaire();
  const { statuses } = computeEffectiveAnswers(items, rawAnswerMap as AnswerMap);
  const itemById = new Map(items.map((item) => [item.id, item]));

  const missingQuestionIds = statuses
    .filter((s) => s.active && !s.hasAnswer && itemById.get(s.questionId)?.isCore)
    .map((s) => s.questionId);

  if (missingQuestionIds.length > 0) {
    return { ok: false, error: "missing_required", missingQuestionIds };
  }

  const assessment = await repos.assessments.markSubmitted(resolved.assessment.id, new Date());

  await repos.audit.record({
    actorType: "client",
    assessmentId: assessment.id,
    eventType: "assessment_submitted",
  });

  return { ok: true, assessment };
}

export type ReopenAssessmentResult =
  | { ok: true; assessment: Assessment }
  | { ok: false; error: "not_found" }
  | { ok: false; error: "not_reopenable" };

/**
 * Attorney-initiated reopen, scoped to SUBMITTED -> DRAFT only
 * (OPEN_QUESTIONS.md item 16) — other statuses aren't reachable by
 * anything built through Phase 2. Always audited with the admin's actor
 * id; there is no client-facing equivalent.
 */
export async function reopenAssessment(
  repos: Repositories,
  assessmentId: string,
  adminActorId: string,
): Promise<ReopenAssessmentResult> {
  const existing = await repos.assessments.getById(assessmentId);
  if (!existing) return { ok: false, error: "not_found" };
  if (existing.status !== "SUBMITTED") return { ok: false, error: "not_reopenable" };

  const assessment = await repos.assessments.reopen(assessmentId);

  await repos.audit.record({
    actorType: "admin",
    actorId: adminActorId,
    assessmentId: assessment.id,
    eventType: "assessment_reopened",
  });

  return { ok: true, assessment };
}
