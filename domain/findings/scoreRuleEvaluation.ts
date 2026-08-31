import type { RuleEvaluationResult } from "@/domain/rules/types";
import { computeConfidence, computeRiskScore } from "@/domain/rules/scoring";
import type { RiskLevel } from "@/lib/db/types";

export interface ScoredRuleEvaluation {
  scopePoints: number;
  durationPoints: number;
  systemicPoints: number;
  disputePoints: number;
  riskScore: number;
  riskLevel: RiskLevel;
  confidence: number;
}

/**
 * OPEN_QUESTIONS.md item 28: no source file maps any of the 42 rules'
 * narrative `rule_catalog.csv` "חישוב היקף / משך / שיטתיות" columns to a
 * specific questionnaire question or fact key, and the only
 * dispute/duration-adjacent questionnaire answers that exist (`HR-01`,
 * `LIT-01`) are company-wide, not tied to any one rule/topic — so
 * inventing either a per-rule mapping or a blanket per-assessment
 * modifier would be inventing exposure logic. Scope/duration/systemic/
 * dispute are therefore always passed as unset here; `computeRiskScore`
 * (task #45) already resolves an unset input to zero points, so the
 * automatic score is a deterministic, conservative lower bound driven
 * only by `baseSeverity`/`criticalOverride` (both always source-defined
 * in `rule_catalog.csv`). The attorney's existing severity-override
 * action (spec §15, mandatory reason) is the approved way to correct a
 * score once the actual scope/duration/dispute context has been
 * reviewed.
 *
 * Confidence, by contrast, *is* honestly derivable from what evidence
 * actually backed the match — spec §12's own scale — so it is computed
 * for real, from which of the rule's own declared inputs contributed:
 * `hasDocumentEvidence` when any contributing input is a
 * `document_extraction.*` fact; `hasOperationalCrossCheck` when any
 * contributing input is a `cross_check.*` fact that resolved `true`.
 * `hasTwoConsistentAnswerSources` has no generic detection rule across
 * arbitrary rule inputs, so it is always `false` here — never invented.
 */
export function scoreRuleEvaluation(result: RuleEvaluationResult): ScoredRuleEvaluation {
  const { riskScore, riskLevel } = computeRiskScore({
    baseSeverity: result.baseSeverity,
    scope: { affectedCount: null, totalEmployeeCount: null },
    durationMonths: null,
    systemic: null,
    dispute: null,
    criticalOverride: result.criticalOverride,
  });

  const inputEntries = Object.entries(result.inputSnapshot);
  const hasDocumentEvidence = inputEntries.some(([key]) => key.startsWith("document_extraction."));
  const hasOperationalCrossCheck = inputEntries.some(
    ([key, value]) => key.startsWith("cross_check.") && value === true,
  );

  const confidence = computeConfidence({
    hasDocumentEvidence,
    hasOperationalCrossCheck,
    hasTwoConsistentAnswerSources: false,
  });

  return { scopePoints: 0, durationPoints: 0, systemicPoints: 0, disputePoints: 0, riskScore, riskLevel, confidence };
}
