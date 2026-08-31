import type { RiskLevel } from "@/lib/db/types";
import type { FreelancerScreeningResult } from "@/domain/rules/freelancerScreening";

export interface ReportFindingView {
  findingId: string;
  ruleId: string | null;
  category: string;
  title: string;
  riskLevel: RiskLevel | null;
  /** Client-facing Hebrew band label (see riskLevelLabels.ts) — client report only. */
  riskLevelLabel: string | null;
  /** Numeric score — internal report only (report_structure.csv: professional output is the raw 0-100 score, client sees only the band). */
  riskScore: number | null;
  confidence: number | null;
  /**
   * "נדרש אימות" ("verification required") when confidence is 1/4
   * (self-report only) — client report only, per report_structure.csv's
   * own "רק כשנדרש" (shown only when needed). Internal reports show the
   * raw 1-4 `confidence` number instead, always.
   */
  confidenceCaveat: string | null;
  recommendedAction: string | null;
  /** Internal report only (report_structure.csv's Commercial section, marked "not necessarily shown" and never client-facing). */
  possibleService: string | null;
  /** Internal report only — the rule's own caution note (never client wording). */
  cautionNote: string | null;
  /** Internal report only — traceability (which facts fed this rule). */
  legalSourceUrl: string | null;
  inputSnapshot: Readonly<Record<string, unknown>> | null;
}

export interface ReportSummary {
  totalFindings: number;
  countByRiskLevel: Readonly<Record<RiskLevel, number>>;
}

export interface ReportData {
  assessmentId: string;
  reportType: "internal" | "client";
  generatedAt: string;
  summary: ReportSummary;
  findings: readonly ReportFindingView[];
  /** Internal report only — see OPEN_QUESTIONS.md item 27/29 for why no level is shown. */
  freelancerScreening: FreelancerScreeningResult | null;
}
