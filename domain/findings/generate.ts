import type { NewFindingInput, RuleEvaluation } from "@/lib/db/types";
import { RULE_CATALOG_BY_ID } from "@/domain/rules/catalog";

/**
 * One `findings` row per matched rule evaluation, plus one for every
 * `alwaysRequiresManualReview` rule (its `evaluate` always returns
 * `false` by design — OPEN_QUESTIONS.md item 21 — so it can never
 * surface via `matched`, yet the attorney must still see it). Every
 * populated field is copied verbatim from `rule_catalog.csv`'s own
 * columns or from the already-scored, already-persisted
 * `RuleEvaluation` — no generated or rephrased wording, no invented
 * fields (spec's "do not invent... report conclusions").
 *
 * `clientTitle` is set to the same verbatim CSV topic text as
 * `internalTitle`: `rule_catalog.csv` has no distinct client-safe title
 * column, `visibleToClient` still defaults to `false` on every finding,
 * and the report-release boundary (task #49/#51) still requires
 * explicit attorney approval before anything reaches the client.
 * `draftClientText` is left `null` — there is no client-safe narrative
 * text anywhere in the source data distinct from the title and the
 * recommendation, and self-generating one would be inventing Hebrew
 * client wording.
 */
export function generateFindingInputs(
  assessmentId: string,
  evaluations: readonly RuleEvaluation[],
): NewFindingInput[] {
  const inputs: NewFindingInput[] = [];

  for (const evaluation of evaluations) {
    const rule = RULE_CATALOG_BY_ID.get(evaluation.ruleId);
    if (!rule) continue; // validateRuleCatalog (task #44) guarantees every real ruleId is in the catalog

    const requiresManualReview = rule.alwaysRequiresManualReview === true;
    if (!evaluation.matched && !requiresManualReview) continue;

    inputs.push({
      assessmentId,
      ruleEvaluationId: evaluation.id,
      category: rule.domainArea,
      subCategory: null,
      internalTitle: rule.topic,
      clientTitle: rule.topic,
      draftInternalText: rule.cautionNote,
      draftClientText: null,
      recommendedAction: rule.recommendation,
      riskScore: evaluation.riskScore,
      riskLevel: evaluation.riskLevel,
      confidence: evaluation.confidence,
    });
  }

  return inputs;
}
