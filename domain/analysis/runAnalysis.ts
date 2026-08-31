import "server-only";
import type { Repositories } from "@/lib/db/repositories";
import type { Assessment, DocumentExtraction, RuleEvaluation } from "@/lib/db/types";
import type { DocumentExtractor } from "@/domain/extraction/types";
import { createSyntheticExtractor } from "@/domain/extraction/syntheticProvider";
import { loadQuestionnaire } from "@/domain/questionnaire/load";
import { buildFactBundle } from "@/domain/facts/bundle";
import { runCrossChecks } from "@/domain/crosscheck";
import { evaluateRules } from "@/domain/rules/evaluate";
import { scoreRuleEvaluation } from "@/domain/findings/scoreRuleEvaluation";
import { generateFindingInputs } from "@/domain/findings/generate";

export interface RunAnalysisOptions {
  /** Defaults to the only real implementation, createSyntheticExtractor() — see OPEN_QUESTIONS.md item 25. */
  extractor?: DocumentExtractor;
  /** Test/pilot-only, applied to every document in this assessment — never set on a real client's Run Analysis call. See OPEN_QUESTIONS.md item 25. */
  fixtureTag?: string;
}

export type RunAnalysisResult =
  | {
      ok: true;
      assessment: Assessment;
      documentCount: number;
      ruleEvaluationCount: number;
      findingCount: number;
      crossCheckIssueCount: number;
    }
  | { ok: false; error: "not_found" }
  | { ok: false; error: "not_submitted" };

/**
 * "Run Analysis" — the single atomic SUBMITTED -> LAWYER_REVIEW action
 * (OPEN_QUESTIONS.md item 22) implementing the Phase 3 instruction's
 * required pipeline end to end: answers/documents -> extraction ->
 * canonical facts -> cross-checks -> deterministic rules -> scored
 * findings. Single-run only (OPEN_QUESTIONS.md item 24) — only callable
 * from `SUBMITTED`, and always starts from a blank rule-evaluation/
 * finding/derived-fact slate for this assessment (nothing here reads or
 * merges a prior run).
 *
 * One coarse `analysis_run` audit event is recorded here (task #53),
 * mirroring the one-event-per-lifecycle-action precedent in
 * domain/assessment/submission.ts. MASTER_BUILD_SPEC.md's own
 * "audit_events" section names the required categories verbatim:
 * "Audit login, link creation, document access, analysis, finding
 * override, approval, report generation and deletion" — "analysis" is
 * one category, not one event per document extracted / fact derived /
 * rule evaluated / finding created. PHASE_3_PLAN.md §12's earlier,
 * more granular event-name list (document_extracted, fact_created,
 * rule_evaluation_run, finding_created) was this project's own draft
 * plan, not a spec requirement — logging 40+ individual rows per
 * analysis run would add volume and complication spec doesn't ask for,
 * without adding traceability the `analysis_run` event's metadata
 * (documentCount/ruleEvaluationCount/findingCount/crossCheckIssueCount)
 * doesn't already give (every individual fact/evaluation/finding is
 * already durably queryable by assessmentId regardless).
 */
export async function runAnalysis(
  repos: Repositories,
  assessmentId: string,
  options: RunAnalysisOptions = {},
): Promise<RunAnalysisResult> {
  const assessment = await repos.assessments.getById(assessmentId);
  if (!assessment) return { ok: false, error: "not_found" };
  if (assessment.status !== "SUBMITTED") return { ok: false, error: "not_submitted" };

  const extractor = options.extractor ?? createSyntheticExtractor();

  const [answers, allDocuments] = await Promise.all([
    repos.answers.listByAssessment(assessmentId),
    repos.documents.listByAssessment(assessmentId),
  ]);
  const documents = allDocuments.filter((d) => d.uploadStatus === "uploaded");
  const items = loadQuestionnaire();

  const extractions: DocumentExtraction[] = [];
  for (const document of documents) {
    const outcome = await extractor.extract({
      documentId: document.id,
      documentType: document.documentType,
      storagePath: document.storagePath,
      sha256: document.sha256,
      fixtureTag: options.fixtureTag,
    });
    const extraction = await repos.documentExtractions.create({
      documentId: document.id,
      schemaName: outcome.schemaName,
      schemaVersion: outcome.schemaVersion,
      provider: outcome.provider,
      model: outcome.model,
      extractionJson: outcome.extractionJson,
      confidenceJson: outcome.confidenceJson,
      evidenceJson: outcome.evidenceJson,
      status: outcome.status,
    });
    extractions.push(extraction);
  }

  const baseBundle = buildFactBundle({ answers, items, storedFacts: [] });
  const crossCheckResult = runCrossChecks(baseBundle.map, extractions, assessmentId);

  for (const fact of crossCheckResult.newFacts) {
    await repos.derivedFacts.create(fact);
  }

  const ruleResults = evaluateRules(crossCheckResult.factMap);
  const persistedEvaluations: RuleEvaluation[] = [];
  for (const result of ruleResults) {
    const scored = scoreRuleEvaluation(result);
    const evaluation = await repos.ruleEvaluations.create({
      assessmentId,
      ruleId: result.ruleId,
      ruleVersion: assessment.ruleEngineVersion,
      matched: result.matched,
      inputSnapshot: result.inputSnapshot,
      baseSeverity: result.baseSeverity,
      scopePoints: scored.scopePoints,
      durationPoints: scored.durationPoints,
      systemicPoints: scored.systemicPoints,
      disputePoints: scored.disputePoints,
      overrideCritical: result.criticalOverride,
      riskScore: scored.riskScore,
      riskLevel: scored.riskLevel,
      confidence: scored.confidence,
    });
    persistedEvaluations.push(evaluation);
  }

  const findingInputs = generateFindingInputs(assessmentId, persistedEvaluations);
  for (const input of findingInputs) {
    await repos.findings.create(input);
  }

  await repos.assessments.updateStatus(assessmentId, "LAWYER_REVIEW");
  const updated = await repos.assessments.getById(assessmentId);
  if (!updated) return { ok: false, error: "not_found" };

  await repos.audit.record({
    actorType: "system",
    assessmentId,
    eventType: "analysis_run",
    metadata: {
      documentCount: documents.length,
      ruleEvaluationCount: ruleResults.length,
      findingCount: findingInputs.length,
      crossCheckIssueCount: crossCheckResult.issues.length,
    },
  });

  return {
    ok: true,
    assessment: updated,
    documentCount: documents.length,
    ruleEvaluationCount: ruleResults.length,
    findingCount: findingInputs.length,
    crossCheckIssueCount: crossCheckResult.issues.length,
  };
}
