import type { FactMap } from "@/domain/facts/types";

/**
 * Small predicate helpers used by domain/rules/catalog.ts's 42 hand-
 * translated rules. Every rule condition ultimately reduces to these —
 * kept separate and reused rather than each rule re-implementing answer
 * lookup/comparison, so the translation from `rule_catalog.csv`'s
 * "תנאי לוגי V1" column stays easy to audit against the CSV by eye.
 */

function answerValue(facts: FactMap, questionId: string): unknown {
  return facts[`answer.${questionId}`];
}

/** Scalar (single_choice/yes_no/yes_no_unknown) equals exactly one of the given real option strings. */
export function answerIn(facts: FactMap, questionId: string, options: readonly string[]): boolean {
  const value = answerValue(facts, questionId);
  return typeof value === "string" && options.includes(value);
}

/** multi_choice selection includes at least one of the given real option strings. */
export function answerIncludesAny(
  facts: FactMap,
  questionId: string,
  options: readonly string[],
): boolean {
  const value = answerValue(facts, questionId);
  return Array.isArray(value) && value.some((v) => options.includes(v));
}

/** multi_choice selection includes none of the given real option strings, and is non-empty. */
export function answerExcludesAll(
  facts: FactMap,
  questionId: string,
  options: readonly string[],
): boolean {
  const value = answerValue(facts, questionId);
  return Array.isArray(value) && value.length > 0 && !value.some((v) => options.includes(v));
}

/** number-type answer strictly greater than threshold. */
export function answerGreaterThan(facts: FactMap, questionId: string, threshold: number): boolean {
  const value = answerValue(facts, questionId);
  return typeof value === "number" && value > threshold;
}

/** A cross-check/system-derived fact (any factKey outside the `answer.` namespace) is exactly `true`. */
export function factTrue(facts: FactMap, factKey: string): boolean {
  return facts[factKey] === true;
}
