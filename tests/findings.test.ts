import { describe, expect, it } from "vitest";
import type { RuleEvaluation } from "@/lib/db/types";
import type { RuleEvaluationResult as PureRuleEvaluationResult } from "@/domain/rules/types";
import { scoreRuleEvaluation } from "@/domain/findings/scoreRuleEvaluation";
import { generateFindingInputs } from "@/domain/findings/generate";
import { RULE_CATALOG_BY_ID } from "@/domain/rules/catalog";
import { evaluateRules } from "@/domain/rules/evaluate";

function result(overrides: Partial<PureRuleEvaluationResult>): PureRuleEvaluationResult {
  return {
    ruleId: "R-EMP-001",
    matched: true,
    requiresManualReview: false,
    inputSnapshot: {},
    baseSeverity: 4,
    criticalOverride: false,
    ...overrides,
  };
}

describe("scoreRuleEvaluation — OPEN_QUESTIONS.md item 28: conservative lower-bound score", () => {
  it("uses only baseSeverity when there is no scope/duration/systemic/dispute source data", () => {
    const scored = scoreRuleEvaluation(result({ baseSeverity: 4 }));
    expect(scored.riskScore).toBe(40); // baseSeverityPoints(4), scope/duration/systemic/dispute all 0
    expect(scored.riskLevel).toBe("MEDIUM");
    expect(scored.scopePoints).toBe(0);
    expect(scored.durationPoints).toBe(0);
    expect(scored.systemicPoints).toBe(0);
    expect(scored.disputePoints).toBe(0);
  });

  it("criticalOverride still forces CRITICAL even with no scope/duration/dispute data", () => {
    const scored = scoreRuleEvaluation(result({ baseSeverity: 1, criticalOverride: true }));
    expect(scored.riskLevel).toBe("CRITICAL");
  });

  it("confidence is 1/4 (self-report only) when no document/cross-check facts contributed", () => {
    const scored = scoreRuleEvaluation(result({ inputSnapshot: { "answer.EMP-01": "לא" } }));
    expect(scored.confidence).toBe(1);
  });

  it("confidence is 3/4 when a document_extraction fact is among the inputs", () => {
    const scored = scoreRuleEvaluation(
      result({ inputSnapshot: { "document_extraction.employment_agreement.overtimeType": "global" } }),
    );
    expect(scored.confidence).toBe(3);
  });

  it("confidence is 4/4 when both a document fact and a true cross_check fact are among the inputs", () => {
    const scored = scoreRuleEvaluation(
      result({
        inputSnapshot: {
          "document_extraction.attendance.actualOvertimeHours": 34,
          "cross_check.time.global_overtime_attendance_mismatch": true,
        },
      }),
    );
    expect(scored.confidence).toBe(4);
  });

  it("a false-valued cross_check input does not count as operational cross-check evidence", () => {
    const scored = scoreRuleEvaluation(
      result({ inputSnapshot: { "cross_check.pay.contract_payslip_mismatch": false } }),
    );
    expect(scored.confidence).toBe(1);
  });

  it("is deterministic", () => {
    const r = result({ baseSeverity: 3, inputSnapshot: { "answer.TIME-06": "כן, באופן קבוע" } });
    expect(scoreRuleEvaluation(r)).toEqual(scoreRuleEvaluation(r));
  });
});

function toPersisted(id: string, r: PureRuleEvaluationResult): RuleEvaluation {
  const scored = scoreRuleEvaluation(r);
  return {
    id,
    assessmentId: "assessment-1",
    ruleId: r.ruleId,
    ruleVersion: "V1",
    matched: r.matched,
    inputSnapshot: r.inputSnapshot,
    baseSeverity: r.baseSeverity,
    scopePoints: scored.scopePoints,
    durationPoints: scored.durationPoints,
    systemicPoints: scored.systemicPoints,
    disputePoints: scored.disputePoints,
    overrideCritical: r.criticalOverride,
    riskScore: scored.riskScore,
    riskLevel: scored.riskLevel,
    confidence: scored.confidence,
    createdAt: new Date().toISOString(),
  };
}

describe("generateFindingInputs", () => {
  it("generates a finding for a matched rule, with every field copied verbatim from the catalog", () => {
    const evaluation = toPersisted("eval-1", result({ ruleId: "R-EMP-001", matched: true, baseSeverity: 4 }));
    const findings = generateFindingInputs("assessment-1", [evaluation]);
    expect(findings).toHaveLength(1);
    const rule = RULE_CATALOG_BY_ID.get("R-EMP-001")!;
    expect(findings[0]).toMatchObject({
      assessmentId: "assessment-1",
      ruleEvaluationId: "eval-1",
      category: rule.domainArea,
      subCategory: null,
      internalTitle: rule.topic,
      clientTitle: rule.topic,
      draftInternalText: rule.cautionNote,
      draftClientText: null,
      recommendedAction: rule.recommendation,
      riskScore: 40,
      riskLevel: "MEDIUM",
    });
  });

  it("does not generate a finding for a non-matched, non-manual rule", () => {
    const evaluation = toPersisted("eval-1", result({ ruleId: "R-EMP-001", matched: false }));
    expect(generateFindingInputs("assessment-1", [evaluation])).toEqual([]);
  });

  it("always generates a finding for an alwaysRequiresManualReview rule, even though matched is false", () => {
    const rule = RULE_CATALOG_BY_ID.get("R-TIME-007")!;
    expect(rule.alwaysRequiresManualReview).toBe(true);
    const evaluation = toPersisted(
      "eval-2",
      result({ ruleId: "R-TIME-007", matched: false, baseSeverity: rule.baseSeverity }),
    );
    const findings = generateFindingInputs("assessment-1", [evaluation]);
    expect(findings).toHaveLength(1);
    expect(findings[0].internalTitle).toBe(rule.topic);
  });

  it("silently skips an evaluation for a ruleId not present in the catalog (defensive, should never happen)", () => {
    const evaluation = toPersisted("eval-x", result({ ruleId: "R-DOES-NOT-EXIST", matched: true }));
    expect(generateFindingInputs("assessment-1", [evaluation])).toEqual([]);
  });

  it("never invents draftClientText — always null, since no client-safe narrative source exists", () => {
    const evaluation = toPersisted("eval-1", result({ ruleId: "R-EMP-001", matched: true }));
    const findings = generateFindingInputs("assessment-1", [evaluation]);
    expect(findings[0].draftClientText).toBeNull();
  });

  it("every finding defaults to draft/hidden-from-client at generation time, per the DB schema default", () => {
    // status/visibleToClient are DB-column defaults ("draft" / false), not
    // set by generateFindingInputs — asserting they are absent from the
    // NewFindingInput confirms this function never overrides that default.
    const evaluation = toPersisted("eval-1", result({ ruleId: "R-EMP-001", matched: true }));
    const findings = generateFindingInputs("assessment-1", [evaluation]);
    expect(findings[0]).not.toHaveProperty("status");
    expect(findings[0]).not.toHaveProperty("visibleToClient");
  });

  it("end-to-end: evaluateRules on a real fact map produces findings only for matched/manual rules, with correct traceability", () => {
    const evaluations = evaluateRules({ "answer.EMP-01": "לא", "answer.EMP-02": "לא" });
    const persisted = evaluations.map((r, i) => toPersisted(`eval-${i}`, r));
    const findings = generateFindingInputs("assessment-1", persisted);

    const empFinding = findings.find((f) => f.ruleEvaluationId === persisted.find((p) => p.ruleId === "R-EMP-001")?.id);
    expect(empFinding).toBeDefined();
    expect(empFinding?.category).toBe("דיני עבודה");

    // Every manual-only rule (5 total, OPEN_QUESTIONS item 21) is present regardless of match.
    const manualRuleIds = [...RULE_CATALOG_BY_ID.values()]
      .filter((r) => r.alwaysRequiresManualReview)
      .map((r) => r.ruleId);
    for (const ruleId of manualRuleIds) {
      const evalRow = persisted.find((p) => p.ruleId === ruleId);
      expect(findings.some((f) => f.ruleEvaluationId === evalRow?.id)).toBe(true);
    }
  });
});
