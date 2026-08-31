import { evaluateCondition, type AnswerMap, type AnswerValue } from "@/domain/branching/evaluate";
import type { QuestionnaireItem } from "@/domain/questionnaire/types";

export interface EffectiveAnswerStatus {
  readonly questionId: string;
  /** Whether this question is currently visible under the current answer set. */
  readonly active: boolean;
  readonly hasAnswer: boolean;
  /** hasAnswer && !active — an answer that predates a branching change and no longer applies. */
  readonly stale: boolean;
}

export interface EffectiveAssessmentAnswers {
  /**
   * Only answers belonging to a currently-visible question. This is the
   * answer set submission validation and any future analysis stage must
   * read — never the raw, unfiltered answer table.
   */
  readonly effectiveAnswers: AnswerMap;
  /** Per-question status for every questionnaire item, including unanswered ones. */
  readonly statuses: readonly EffectiveAnswerStatus[];
  /** Question IDs with a stored answer whose question is no longer active. */
  readonly staleQuestionIds: readonly string[];
}

/**
 * Computes which stored answers still apply after a client has revised an
 * earlier branching answer. See OPEN_QUESTIONS.md item 18 for why a single
 * left-to-right pass over `items` (expected to be in questionnaire.csv
 * order) is deterministic and sufficient: every trigger condition in the
 * generated questionnaire references only question IDs earlier in that
 * order, so a question's visibility can always be decided from the
 * effective answers of questions already processed.
 *
 * Pure and side-effect free; nothing here deletes or mutates stored
 * answers — stale answers stay in the database for audit/history and are
 * only excluded from the returned `effectiveAnswers`.
 */
export function computeEffectiveAnswers(
  items: readonly QuestionnaireItem[],
  rawAnswers: AnswerMap,
): EffectiveAssessmentAnswers {
  const effectiveAnswers: Record<string, AnswerValue> = {};
  const statuses: EffectiveAnswerStatus[] = [];
  const staleQuestionIds: string[] = [];

  for (const item of items) {
    const active = evaluateCondition(item.triggerCondition, effectiveAnswers);
    const rawValue = rawAnswers[item.id];
    const hasAnswer = rawValue !== null && rawValue !== undefined;

    if (active && hasAnswer) {
      effectiveAnswers[item.id] = rawValue;
    }
    if (!active && hasAnswer) {
      staleQuestionIds.push(item.id);
    }

    statuses.push({ questionId: item.id, active, hasAnswer, stale: !active && hasAnswer });
  }

  return { effectiveAnswers, statuses, staleQuestionIds };
}
