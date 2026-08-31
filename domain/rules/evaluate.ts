import type { FactMap } from "@/domain/facts/types";
import { RULE_CATALOG } from "@/domain/rules/catalog";
import type { RuleDefinition, RuleEvaluationResult } from "@/domain/rules/types";

/**
 * Pure evaluator: (facts, catalog) -> one RuleEvaluationResult per rule
 * (PHASE_3_PLAN.md §4). Every rule always produces a result, for full
 * traceability — "store which facts triggered each finding" is the
 * `inputSnapshot` (only the fact keys this specific rule declares as its
 * own inputs, not the entire fact bundle). No `eval`/`new Function`
 * anywhere; `RuleDefinition.evaluate` is a plain typed function.
 */
export function evaluateRules(
  facts: FactMap,
  catalog: readonly RuleDefinition[] = RULE_CATALOG,
): RuleEvaluationResult[] {
  return catalog.map((rule) => evaluateOne(rule, facts));
}

function evaluateOne(rule: RuleDefinition, facts: FactMap): RuleEvaluationResult {
  const matched = rule.evaluate(facts);
  return {
    ruleId: rule.ruleId,
    matched,
    requiresManualReview: rule.alwaysRequiresManualReview === true,
    inputSnapshot: snapshotInputs(rule, facts),
    baseSeverity: rule.baseSeverity,
    criticalOverride: rule.criticalOverride,
  };
}

/**
 * Only the facts this rule actually declares as inputs — not the whole
 * bundle. A question ID (e.g. `"EMP-01"`) resolves to its `answer.*`
 * fact; a rule that also reads a cross-check/document-extraction fact
 * lists that fact's full dotted key directly in `inputs` (e.g.
 * `"cross_check.pay.contract_payslip_mismatch"` on R-PAY-002), which
 * resolves via the plain lookup below.
 */
function snapshotInputs(rule: RuleDefinition, facts: FactMap): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};
  for (const input of rule.inputs) {
    const answerKey = `answer.${input}`;
    if (answerKey in facts) {
      snapshot[answerKey] = facts[answerKey];
    } else if (input in facts) {
      snapshot[input] = facts[input];
    }
  }
  return snapshot;
}
