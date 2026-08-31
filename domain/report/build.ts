import type { Finding, RiskLevel, RuleEvaluation } from "@/lib/db/types";
import { RULE_CATALOG_BY_ID } from "@/domain/rules/catalog";
import { RISK_LEVEL_LABEL_HE, RISK_LEVEL_ORDER } from "@/domain/report/riskLevelLabels";
import type { FreelancerScreeningResult } from "@/domain/rules/freelancerScreening";
import type { ReportData, ReportFindingView, ReportSummary } from "@/domain/report/types";

function emptyCountByRiskLevel(): Record<RiskLevel, number> {
  const counts = {} as Record<RiskLevel, number>;
  for (const level of RISK_LEVEL_ORDER) counts[level] = 0;
  return counts;
}

function summarize(findings: readonly Finding[]): ReportSummary {
  const countByRiskLevel = emptyCountByRiskLevel();
  for (const finding of findings) {
    if (finding.riskLevel) countByRiskLevel[finding.riskLevel] += 1;
  }
  return { totalFindings: findings.length, countByRiskLevel };
}

function toFindingView(
  finding: Finding,
  reportType: "internal" | "client",
  ruleEvaluationsById: ReadonlyMap<string, RuleEvaluation>,
): ReportFindingView {
  const evaluation = finding.ruleEvaluationId ? ruleEvaluationsById.get(finding.ruleEvaluationId) : undefined;
  const rule = evaluation ? RULE_CATALOG_BY_ID.get(evaluation.ruleId) : undefined;
  const isClient = reportType === "client";

  return {
    findingId: finding.id,
    ruleId: evaluation?.ruleId ?? null,
    category: finding.category,
    title: isClient ? (finding.clientTitle ?? finding.internalTitle) : finding.internalTitle,
    riskLevel: finding.riskLevel,
    riskLevelLabel: isClient && finding.riskLevel ? RISK_LEVEL_LABEL_HE[finding.riskLevel] : null,
    riskScore: isClient ? null : finding.riskScore,
    confidence: isClient ? null : finding.confidence,
    confidenceCaveat: isClient && finding.confidence === 1 ? "נדרש אימות" : null,
    recommendedAction: finding.recommendedAction,
    possibleService: isClient ? null : (rule?.possibleService ?? null),
    cautionNote: isClient ? null : finding.draftInternalText,
    legalSourceUrl: isClient ? null : (rule?.legalSourceUrl ?? null),
    inputSnapshot: isClient ? null : (evaluation?.inputSnapshot ?? null),
  };
}

/**
 * Builds the structured content for one report (OPEN_QUESTIONS.md item
 * 29): the client report includes only `visibleToClient === true`
 * findings — nothing else is filtered or reworded. No narrative
 * prose/summary sentence is ever generated (item 29 §1); the summary is
 * a factual tally only.
 */
export function buildReportData(
  assessmentId: string,
  reportType: "internal" | "client",
  allFindings: readonly Finding[],
  ruleEvaluationsById: ReadonlyMap<string, RuleEvaluation>,
  freelancerScreening: FreelancerScreeningResult | null,
): ReportData {
  const findings = reportType === "client" ? allFindings.filter((f) => f.visibleToClient) : allFindings;

  return {
    assessmentId,
    reportType,
    generatedAt: new Date().toISOString(),
    summary: summarize(findings),
    findings: findings.map((f) => toFindingView(f, reportType, ruleEvaluationsById)),
    // Item 29 §3: no LOW/MEDIUM/SIGNIFICANT/HIGH level exists (item 27), so
    // the client report never shows this section at all.
    freelancerScreening: reportType === "internal" ? freelancerScreening : null,
  };
}
