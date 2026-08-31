import type { DocumentExtraction, NewDerivedFactInput } from "@/lib/db/types";
import type { FactMap } from "@/domain/facts/types";
import { flattenExtractionToFacts } from "@/domain/crosscheck/normalizeExtraction";
import { crossCheckEmployeeNotice } from "@/domain/crosscheck/employeeNotice";
import { crossCheckGlobalOvertime } from "@/domain/crosscheck/globalOvertime";
import { crossCheckPrivacy } from "@/domain/crosscheck/privacyContradiction";
import { crossCheckFreelancerAggregation } from "@/domain/crosscheck/freelancerAggregation";
import type { CrossCheckIssue } from "@/domain/crosscheck/types";

export type { CrossCheckIssue, CrossCheckIssueType, CrossCheckOutcome } from "@/domain/crosscheck/types";

const DEMONSTRATIONS = [
  crossCheckEmployeeNotice,
  crossCheckGlobalOvertime,
  crossCheckPrivacy,
  crossCheckFreelancerAggregation,
] as const;

export interface CrossCheckRunResult {
  /** baseFacts + flattened document-extraction facts + cross-check-derived facts — ready for domain/rules evaluateRules. */
  factMap: FactMap;
  /** Derived-fact rows (extraction-derived and cross-check-derived) ready to persist via DerivedFactRepository. */
  newFacts: readonly NewDerivedFactInput[];
  /** All issues surfaced across the four demonstrations, for the attorney review workspace — informational, never findings. */
  issues: readonly CrossCheckIssue[];
}

/**
 * Orchestrates the cross-check engine (spec §10/§21, PHASE_3_PLAN.md
 * §8): flattens document extractions into facts, then runs all four
 * spec-mandated cross-check demonstrations against the combined fact
 * map (questionnaire answers + document-extraction facts). The
 * resulting `factMap` is what `domain/rules/evaluate.ts`'s
 * `evaluateRules` should be called with — cross-check results are
 * ordinary facts to the Rule Engine, never findings themselves.
 */
export function runCrossChecks(
  baseFacts: FactMap,
  extractions: readonly DocumentExtraction[],
  assessmentId: string,
): CrossCheckRunResult {
  const extractionFacts = extractions.flatMap((extraction) =>
    flattenExtractionToFacts(extraction, assessmentId),
  );

  const factsWithExtractions: Record<string, unknown> = { ...baseFacts };
  for (const fact of extractionFacts) {
    factsWithExtractions[fact.factKey] = fact.valueJson;
  }

  const crossCheckFacts: Record<string, boolean> = {};
  const issues: CrossCheckIssue[] = [];
  for (const demonstration of DEMONSTRATIONS) {
    const outcome = demonstration(factsWithExtractions as FactMap);
    Object.assign(crossCheckFacts, outcome.facts);
    issues.push(...outcome.issues);
  }

  const crossCheckFactInputs: NewDerivedFactInput[] = Object.entries(crossCheckFacts).map(
    ([factKey, valueJson]) => ({
      assessmentId,
      factKey,
      valueJson,
      sourceType: "cross_check",
      sourceId: null,
      confidence: 3,
    }),
  );

  return {
    factMap: { ...factsWithExtractions, ...crossCheckFacts },
    newFacts: [...extractionFacts, ...crossCheckFactInputs],
    issues,
  };
}
