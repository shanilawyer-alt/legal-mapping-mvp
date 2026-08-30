import type { Clause, ConditionNode } from "@/domain/branching/types";

/** The shape an answer can take, matching answers.value_json (spec §5). */
export type AnswerValue = string | number | boolean | string[] | null | undefined;

export type AnswerMap = Readonly<Record<string, AnswerValue>>;

/**
 * Pure evaluator: (AST, current answers) -> boolean. No side effects, no
 * I/O, safe to call on every keystroke while rendering the questionnaire.
 *
 * An unanswered question a clause depends on evaluates to "condition not
 * met" (the conditional question stays hidden) rather than throwing or
 * guessing — matching the product requirement that clients only ever see
 * the ~10-15 minute relevant subset (spec §6).
 */
export function evaluateCondition(node: ConditionNode, answers: AnswerMap): boolean {
  switch (node.type) {
    case "always":
      return true;
    case "or":
      return node.clauses.some((clause) => evaluateCondition(clause, answers));
    case "clause":
      return evaluateClause(node, answers);
  }
}

function evaluateClause(clause: Clause, answers: AnswerMap): boolean {
  const value = answers[clause.questionId];

  if (value === null || value === undefined) return false;

  switch (clause.operator) {
    case ">": {
      const numeric = toNumber(value);
      if (numeric === null) return false;
      const threshold = Number(clause.values[0]);
      return numeric > threshold;
    }
    case "=":
    case "כולל":
      return matchesAny(value, clause.values);
    case "≠":
      return !matchesAny(value, clause.values);
  }
}

function matchesAny(value: AnswerValue, candidates: readonly string[]): boolean {
  if (Array.isArray(value)) {
    return value.some((v) => candidates.includes(v));
  }
  return candidates.includes(String(value));
}

function toNumber(value: AnswerValue): number | null {
  if (typeof value === "number") return value;
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  return null;
}
