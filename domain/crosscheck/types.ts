import type { FactMap } from "@/domain/facts/types";

/**
 * Cross-check engine (spec §10/§21, PHASE_3_PLAN.md §8): deterministic
 * comparisons between questionnaire answers, extracted document facts,
 * and system-derived facts. Cross-checks never produce findings
 * themselves — they only produce facts (booleans/flags) that the
 * deterministic Rule Engine (`domain/rules`) may then read as ordinary
 * inputs, exactly like any other fact. This keeps cross-check results
 * "separate from final findings until the deterministic rules evaluate
 * them" per the Phase 3 instruction.
 */

export type CrossCheckIssueType =
  | "contradiction"
  | "missing_expected_evidence"
  | "mismatch"
  | "requires_attorney_review";

export interface CrossCheckIssue {
  /** dot-namespaced, matches the fact key this issue's boolean result was published under. */
  factKey: string;
  issueType: CrossCheckIssueType;
  /** Neutral, factual description — never an accusation or a legal conclusion. */
  description: string;
  /** Which raw fact keys were compared to reach this result, for attorney-facing traceability. */
  basedOn: readonly string[];
}

export interface CrossCheckOutcome {
  /** New facts produced by the cross-checks, ready to merge into a FactMap (e.g. via buildFactBundle). */
  facts: Readonly<Record<string, boolean>>;
  /** Human-readable issues surfaced for the attorney review workspace — informational, not findings. */
  issues: readonly CrossCheckIssue[];
}

export type CrossCheckFn = (facts: FactMap) => CrossCheckOutcome;
