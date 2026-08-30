import {
  type ConditionNode,
  type ComparisonOperator,
  UnparseableConditionError,
} from "@/domain/branching/types";

const ALWAYS_VALUES = new Set(["", "תמיד"]);
const OR_SPLIT = /\s+או\s+/u;
const CLAUSE_PATTERN =
  /^([A-Za-z]+-\d+)\s*(=|≠|>|כולל)\s*(.+)$/u;

/**
 * Parses a single trigger string (the "מתי מוצג" column) into a typed AST.
 * No eval()/new Function() — this is a plain recursive-descent parser over
 * a deliberately small grammar (see IMPLEMENTATION_PLAN.md §5):
 *
 *   condition := clause (' או ' clause)*
 *   clause    := QUESTION_ID op value
 *   op        := '=' | '≠' | '>' | 'כולל'
 *   value     := token ('/' token)*
 */
export function parseCondition(raw: string): ConditionNode {
  const trimmed = raw.trim();

  if (ALWAYS_VALUES.has(trimmed)) {
    return { type: "always" };
  }

  const orParts = trimmed.split(OR_SPLIT).map((part) => part.trim());

  if (orParts.length > 1) {
    return {
      type: "or",
      clauses: orParts.map((part) => parseClause(part, raw)),
    };
  }

  return parseClause(orParts[0], raw);
}

function parseClause(part: string, original: string) {
  const match = CLAUSE_PATTERN.exec(part);
  if (!match) {
    throw new UnparseableConditionError(
      original,
      `segment "${part}" does not match QUESTION_ID (op) value`,
    );
  }

  const [, questionId, operatorRaw, valueRaw] = match;
  const operator = operatorRaw as ComparisonOperator;

  if (operator === ">") {
    const numeric = valueRaw.trim();
    if (!/^-?\d+(\.\d+)?$/.test(numeric)) {
      throw new UnparseableConditionError(
        original,
        `operator ">" requires a numeric value, got "${valueRaw}"`,
      );
    }
    return {
      type: "clause" as const,
      questionId,
      operator,
      values: [numeric],
    };
  }

  const values = valueRaw
    .split("/")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);

  if (values.length === 0) {
    throw new UnparseableConditionError(
      original,
      `segment "${part}" has no value after the operator`,
    );
  }

  return { type: "clause" as const, questionId, operator, values };
}

/**
 * Parses a condition, returning null instead of throwing when the string
 * doesn't fit the supported grammar. Used by the CSV importer, which must
 * report every unparseable trigger rather than silently accepting or
 * crashing on one bad row.
 */
export function tryParseCondition(raw: string): ConditionNode | null {
  try {
    return parseCondition(raw);
  } catch {
    return null;
  }
}
