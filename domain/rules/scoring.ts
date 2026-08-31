import type { RiskLevel } from "@/lib/db/types";

/**
 * Risk/exposure scoring — spec §12, exactly. "Risk score is a
 * prioritization mechanism, not probability of liability." Every point
 * table below is cross-checked against `exposure_factors.csv` at test
 * time (validateScoringTables.ts) — the numbers here are not invented,
 * they are `exposure_factors.csv`'s own values.
 */

export type SystemicLevel = "isolated" | "repeated" | "policy";
export type DisputeLevel = "none" | "complaint" | "legal_process";
export type ConfidenceLevel = 1 | 2 | 3 | 4;

export interface ScopeInput {
  affectedCount: number | null;
  /** null = total employee count unknown — use the absolute bucket only, and the caller must reflect this in a lower confidence (spec §12: "If total employee count is unknown, use the absolute bucket and lower confidence"). */
  totalEmployeeCount: number | null;
}

/** 1 = 10, 2 = 20, 3 = 30, 4 = 40, 5 = 50. */
export function baseSeverityPoints(severity: number): number {
  return severity * 10;
}

function absoluteScopeBucket(count: number): number {
  if (count <= 0) return 0;
  if (count === 1) return 5;
  if (count <= 5) return 10;
  if (count <= 20) return 15;
  return 20;
}

function percentageScopeBucket(percentage: number): number {
  if (percentage <= 10) return 5;
  if (percentage <= 25) return 10;
  if (percentage <= 50) return 15;
  return 20;
}

/** `scopePoints = max(absoluteBucket, percentageBucket)` — spec §12's corrected V1 rule. */
export function scopePoints(input: ScopeInput): number {
  if (input.affectedCount == null) return 0;
  const absolute = absoluteScopeBucket(input.affectedCount);
  if (input.totalEmployeeCount == null || input.totalEmployeeCount <= 0) {
    return absolute;
  }
  const percentage = (input.affectedCount / input.totalEmployeeCount) * 100;
  return Math.max(absolute, percentageScopeBucket(percentage));
}

/** <3mo = 2, 3-11 = 4, 12-35 = 7, >=36 = 10. */
export function durationPoints(months: number | null): number {
  if (months == null) return 0;
  if (months < 3) return 2;
  if (months <= 11) return 4;
  if (months <= 35) return 7;
  return 10;
}

/** isolated = 0, repeated = 5, policy/systemic = 10. */
export function systemicPoints(level: SystemicLevel | null): number {
  if (level === "policy") return 10;
  if (level === "repeated") return 5;
  return 0;
}

/** none = 0, complaint/dispute = 5, demand letter/court/administrative = 10. */
export function disputePoints(level: DisputeLevel | null): number {
  if (level === "legal_process") return 10;
  if (level === "complaint") return 5;
  return 0;
}

function riskBand(score: number): RiskLevel {
  if (score >= 80) return "CRITICAL";
  if (score >= 65) return "HIGH";
  if (score >= 45) return "SIGNIFICANT";
  if (score >= 25) return "MEDIUM";
  return "LOW";
}

export interface RiskScoreInput {
  baseSeverity: number; // 1-5, from the matched rule
  scope: ScopeInput;
  durationMonths: number | null;
  systemic: SystemicLevel | null;
  dispute: DisputeLevel | null;
  /** From the matched rule's own "Override קריטי?" flag — forces CRITICAL regardless of numeric score. */
  criticalOverride: boolean;
}

export interface RiskScoreResult {
  baseSeverityPoints: number;
  scopePoints: number;
  durationPoints: number;
  systemicPoints: number;
  disputePoints: number;
  /** `min(100, base + scope + duration + systemic + dispute)`. */
  riskScore: number;
  riskLevel: RiskLevel;
}

export function computeRiskScore(input: RiskScoreInput): RiskScoreResult {
  const base = baseSeverityPoints(input.baseSeverity);
  const scope = scopePoints(input.scope);
  const duration = durationPoints(input.durationMonths);
  const systemic = systemicPoints(input.systemic);
  const dispute = disputePoints(input.dispute);
  const riskScore = Math.min(100, base + scope + duration + systemic + dispute);

  return {
    baseSeverityPoints: base,
    scopePoints: scope,
    durationPoints: duration,
    systemicPoints: systemic,
    disputePoints: dispute,
    riskScore,
    riskLevel: input.criticalOverride ? "CRITICAL" : riskBand(riskScore),
  };
}

/**
 * Confidence is entirely separate from risk score — spec §12: "Confidence
 * must never increase risk." It is never fed into `computeRiskScore`.
 * 1/4 self-report only, 2/4 two consistent sources, 3/4 documentary
 * evidence, 4/4 document + operational cross-check.
 */
export function computeConfidence(params: {
  hasDocumentEvidence: boolean;
  hasOperationalCrossCheck: boolean;
  hasTwoConsistentAnswerSources: boolean;
}): ConfidenceLevel {
  if (params.hasDocumentEvidence && params.hasOperationalCrossCheck) return 4;
  if (params.hasDocumentEvidence) return 3;
  if (params.hasTwoConsistentAnswerSources) return 2;
  return 1;
}
