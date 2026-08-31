import type { Answer } from "@/lib/db/types";
import type { QuestionnaireItem } from "@/domain/questionnaire/types";
import { computeEffectiveAnswers } from "@/domain/questionnaire/effective";
import type { AnswerValue } from "@/domain/branching/evaluate";
import type { FactRecord } from "@/domain/facts/types";

/**
 * Derives one fact per currently-effective questionnaire answer
 * (factKey `answer.<QUESTION_ID>`, e.g. `answer.GEN-04`), reusing
 * `computeEffectiveAnswers()` (Phase 2, domain/questionnaire/effective.ts)
 * rather than re-deriving branching/staleness logic — a stale answer to a
 * now-hidden question never becomes a fact, exactly the same guarantee
 * the submission gate already relies on (OPEN_QUESTIONS.md item 18).
 *
 * Confidence is always 1 ("self-report only" — spec §12's own confidence
 * scale), never higher: a questionnaire answer alone is exactly that
 * evidence tier until corroborated by a document or cross-check.
 *
 * Deliberately NOT persisted as `derived_facts` rows: computed fresh
 * from `answers` on every read instead. Persisting one row per answered
 * question (up to 103 per assessment) would duplicate data already
 * durably stored, gain no traceability `answers` doesn't already have
 * (via `Answer.id`, used here as `sourceId`), and go stale the moment a
 * client edits an answer before the next analysis run. `derived_facts`
 * rows are reserved for facts with no other natural home: document
 * extraction output and cross-check/system-derived calculations.
 */
export function deriveFactsFromAnswers(
  answers: readonly Answer[],
  items: readonly QuestionnaireItem[],
): FactRecord[] {
  const rawAnswerMap: Record<string, AnswerValue> = {};
  for (const answer of answers) rawAnswerMap[answer.questionId] = answer.valueJson as AnswerValue;

  const { effectiveAnswers } = computeEffectiveAnswers(items, rawAnswerMap);
  const answerByQuestionId = new Map(answers.map((a) => [a.questionId, a]));

  const facts: FactRecord[] = [];
  for (const [questionId, value] of Object.entries(effectiveAnswers)) {
    if (value === null || value === undefined) continue;
    const answerRow = answerByQuestionId.get(questionId);
    if (!answerRow) continue;
    facts.push({
      factKey: `answer.${questionId}`,
      valueJson: value,
      sourceType: "answer",
      sourceId: answerRow.id,
      confidence: 1,
      createdAt: answerRow.answeredAt,
    });
  }
  return facts;
}
