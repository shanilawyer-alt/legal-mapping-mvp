import type { AnswerValue } from "@/domain/branching/evaluate";
import {
  YES_NO_OPTIONS,
  YES_NO_UNKNOWN_OPTIONS,
  type QuestionnaireItem,
} from "@/domain/questionnaire/types";

export type AnswerValidationError =
  | "unknown_question"
  | "invalid_type"
  | "invalid_option"
  | "invalid_options";

export type AnswerValidationResult =
  | { ok: true }
  | { ok: false; error: AnswerValidationError };

/**
 * Server-side counterpart to the choices the client field component
 * already offers (components/assessment/question-field.tsx) — a client
 * "must not submit values incompatible with the configured answer
 * type/options" (Phase 2 spec item 9). The browser's own controls make
 * an invalid value hard to produce by hand, but the API must not trust
 * that: any direct POST to /api/assessments/answers goes through this.
 *
 * `null`/`undefined` (clearing an answer) is always valid regardless of
 * type — "this question has no stored answer" is a legitimate state, and
 * whether a question is *required* is a submission-time concern (see
 * domain/assessment/submission.ts), not a per-write one.
 */
export function validateAnswerValue(
  item: QuestionnaireItem,
  value: AnswerValue,
): AnswerValidationResult {
  if (value === null || value === undefined) {
    return { ok: true };
  }

  switch (item.answerType) {
    case "short_text": {
      if (typeof value !== "string") return { ok: false, error: "invalid_type" };
      return { ok: true };
    }

    case "number":
    case "hours": {
      if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
        return { ok: false, error: "invalid_type" };
      }
      return { ok: true };
    }

    case "yes_no": {
      if (typeof value !== "string" || !YES_NO_OPTIONS.includes(value as never)) {
        return { ok: false, error: "invalid_option" };
      }
      return { ok: true };
    }

    case "yes_no_unknown": {
      if (typeof value !== "string" || !YES_NO_UNKNOWN_OPTIONS.includes(value as never)) {
        return { ok: false, error: "invalid_option" };
      }
      return { ok: true };
    }

    case "single_choice": {
      if (typeof value !== "string") return { ok: false, error: "invalid_type" };
      const options = item.options ?? [];
      if (!options.includes(value)) return { ok: false, error: "invalid_option" };
      return { ok: true };
    }

    case "multi_choice": {
      if (!Array.isArray(value) || !value.every((v) => typeof v === "string")) {
        return { ok: false, error: "invalid_type" };
      }
      const options = item.options ?? [];
      if (value.some((v) => !options.includes(v))) {
        return { ok: false, error: "invalid_options" };
      }
      return { ok: true };
    }
  }
}

/**
 * Collapses "answered, but with nothing meaningful in it" (an empty
 * string from a blurred text field, an empty array from a checkbox group
 * with everything unchecked) down to `null` before it is validated or
 * stored — so "no answer" has exactly one representation, which is what
 * `computeEffectiveAnswers()`'s `hasAnswer` check and the submission
 * required-question check both rely on.
 */
export function normalizeAnswerValue(item: QuestionnaireItem, value: unknown): AnswerValue {
  if (value === undefined || value === null) return null;
  if (item.answerType === "short_text" && typeof value === "string" && value.trim() === "") {
    return null;
  }
  if (item.answerType === "multi_choice" && Array.isArray(value) && value.length === 0) {
    return null;
  }
  return value as AnswerValue;
}
