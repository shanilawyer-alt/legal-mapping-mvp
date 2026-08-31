import type { FactMap } from "@/domain/facts/types";
import { computeFreelancerScreening } from "@/domain/rules/freelancerScreening";
import type { CrossCheckOutcome } from "@/domain/crosscheck/types";

/**
 * Cross-check demonstration 4 (spec §10/§21): aggregates the freelancer
 * screening indicators (domain/rules/freelancerScreening.ts, spec §13)
 * into one persisted fact so it is visible in the same fact-provenance
 * trail as every other cross-check, and can be inspected by the
 * attorney review workspace alongside every other cross-check issue.
 * The raw point total only — see OPEN_QUESTIONS.md item 27 for why no
 * LOW/MEDIUM/SIGNIFICANT/HIGH band is computed anywhere in this
 * codebase.
 */
export function crossCheckFreelancerAggregation(facts: FactMap): CrossCheckOutcome {
  const result = computeFreelancerScreening(facts);
  const contributingCount = result.indicators.filter((i) => i.contributed).length;

  return {
    facts: {
      // Any non-zero net point total is surfaced as "attorney should
      // review the screening breakdown" — not a legal-status conclusion.
      "cross_check.freelancer.screening_indicators_present": contributingCount > 0,
    },
    issues:
      contributingCount > 0
        ? [
            {
              factKey: "cross_check.freelancer.screening_indicators_present",
              issueType: "requires_attorney_review",
              description: `${contributingCount} freelancer-dependency screening indicator(s) contributed (net ${result.totalPoints} points). ${result.disclosure}`,
              basedOn: result.indicators.filter((i) => i.contributed).map((i) => `answer.${i.questionId}`),
            },
          ]
        : [],
  };
}
