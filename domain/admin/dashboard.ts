import "server-only";
import type { Repositories } from "@/lib/db/repositories";
import type { AssessmentStatus } from "@/lib/db/types";
import type { AnswerValue } from "@/domain/branching/evaluate";
import { loadQuestionnaire } from "@/domain/questionnaire/load";
import { computeEffectiveAnswers } from "@/domain/questionnaire/effective";

/**
 * Assembles the admin dashboard's per-assessment row (Phase 2 spec item 4).
 * Every value not directly stored on `assessments` is a documented
 * derivation, not a guess — see OPEN_QUESTIONS.md items 13/14:
 *  - lastActivityAt: max(assessment.updatedAt, latest answer, latest
 *    document upload) — computed here, not a stored column.
 *  - employeeCount/freelancerCount: read from the client's own answers to
 *    GEN-04/GEN-06, not the unused `organizations` count columns.
 *  - requiredAnswered/requiredTotal: how many currently-active core
 *    questions have an answer, using the same effective-answers
 *    computation (item 18) the submission gate itself uses — so this
 *    number always matches what would block or allow a client submit.
 */
export interface AdminAssessmentSummary {
  id: string;
  organizationName: string;
  status: AssessmentStatus;
  createdAt: string;
  lastActivityAt: string;
  submittedAt: string | null;
  requiredAnswered: number;
  requiredTotal: number;
  employeeCount: number | null;
  freelancerCount: number | null;
}

export async function listAdminAssessmentSummaries(
  repos: Repositories,
): Promise<AdminAssessmentSummary[]> {
  const [assessments, items] = [await repos.assessments.listAll(), loadQuestionnaire()];
  const itemById = new Map(items.map((item) => [item.id, item]));

  const summaries = await Promise.all(
    assessments.map(async (assessment): Promise<AdminAssessmentSummary> => {
      const [org, answers, documents] = await Promise.all([
        repos.organizations.getById(assessment.organizationId),
        repos.answers.listByAssessment(assessment.id),
        repos.documents.listByAssessment(assessment.id),
      ]);

      const rawAnswerMap: Record<string, AnswerValue> = {};
      for (const answer of answers) rawAnswerMap[answer.questionId] = answer.valueJson as AnswerValue;

      const { statuses } = computeEffectiveAnswers(items, rawAnswerMap);
      const requiredStatuses = statuses.filter(
        (s) => s.active && itemById.get(s.questionId)?.isCore,
      );
      const requiredAnswered = requiredStatuses.filter((s) => s.hasAnswer).length;

      const activityTimestamps = [
        assessment.updatedAt,
        ...answers.map((a) => a.answeredAt),
        ...documents.map((d) => d.uploadedAt),
      ];
      const lastActivityAt = activityTimestamps.reduce(
        (latest, iso) => (iso > latest ? iso : latest),
        assessment.createdAt,
      );

      return {
        id: assessment.id,
        organizationName: org?.legalName ?? "—",
        status: assessment.status,
        createdAt: assessment.createdAt,
        lastActivityAt,
        submittedAt: assessment.submittedAt,
        requiredAnswered,
        requiredTotal: requiredStatuses.length,
        employeeCount: toNonNegativeInteger(rawAnswerMap["GEN-04"]),
        freelancerCount: toNonNegativeInteger(rawAnswerMap["GEN-06"]),
      };
    }),
  );

  return summaries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

function toNonNegativeInteger(value: AnswerValue): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}
