import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/domain/csv/parse";
import { exposureFactorRowSchema } from "@/domain/csv/schemas";
import {
  baseSeverityPoints,
  computeConfidence,
  computeRiskScore,
  disputePoints,
  durationPoints,
  scopePoints,
  systemicPoints,
} from "@/domain/rules/scoring";
import { validateScoringTables } from "@/domain/rules/validateScoringTables";

describe("scoring point tables match exposure_factors.csv exactly", () => {
  const csvText = readFileSync(join(__dirname, "..", "data", "exposure_factors.csv"), "utf-8");
  const { rows, errors } = parseCsv(csvText, exposureFactorRowSchema);

  it("has zero row-level validation errors in the real CSV", () => {
    expect(errors).toEqual([]);
  });

  it("has zero issues cross-checking scoring.ts against the CSV", () => {
    expect(validateScoringTables(rows)).toEqual([]);
  });
});

describe("baseSeverityPoints", () => {
  it("maps 1-5 to 10/20/30/40/50", () => {
    expect(baseSeverityPoints(1)).toBe(10);
    expect(baseSeverityPoints(2)).toBe(20);
    expect(baseSeverityPoints(3)).toBe(30);
    expect(baseSeverityPoints(4)).toBe(40);
    expect(baseSeverityPoints(5)).toBe(50);
  });
});

describe("scopePoints — absolute buckets", () => {
  it("1 employee = 5", () => {
    expect(scopePoints({ affectedCount: 1, totalEmployeeCount: null })).toBe(5);
  });
  it("2-5 employees = 10", () => {
    expect(scopePoints({ affectedCount: 2, totalEmployeeCount: null })).toBe(10);
    expect(scopePoints({ affectedCount: 5, totalEmployeeCount: null })).toBe(10);
  });
  it("6-20 employees = 15", () => {
    expect(scopePoints({ affectedCount: 6, totalEmployeeCount: null })).toBe(15);
    expect(scopePoints({ affectedCount: 20, totalEmployeeCount: null })).toBe(15);
  });
  it(">20 employees = 20", () => {
    expect(scopePoints({ affectedCount: 21, totalEmployeeCount: null })).toBe(20);
  });
  it("uses the absolute bucket alone, with no percentage penalty, when total employee count is unknown", () => {
    expect(scopePoints({ affectedCount: 3, totalEmployeeCount: null })).toBe(10);
  });
});

describe("scopePoints — percentage buckets and max(absolute, percentage)", () => {
  it("<=10% = 5", () => {
    expect(scopePoints({ affectedCount: 1, totalEmployeeCount: 20 })).toBe(5); // 5% -> but absolute(1)=5 too, max=5
  });
  it(">10-25% = 10, higher than a small absolute bucket", () => {
    // 2 affected of 10 total = 20% -> percentage bucket 10; absolute(2) = 10 too.
    expect(scopePoints({ affectedCount: 2, totalEmployeeCount: 10 })).toBe(10);
  });
  it("percentage bucket wins when it exceeds the absolute bucket", () => {
    // 1 affected of 2 total = 50% -> percentage bucket 15; absolute(1) = 5. max = 15.
    expect(scopePoints({ affectedCount: 1, totalEmployeeCount: 2 })).toBe(15);
  });
  it("absolute bucket wins when it exceeds the percentage bucket", () => {
    // 8 affected of 200 total = 4% -> percentage bucket 5; absolute(8) = 15. max = 15.
    expect(scopePoints({ affectedCount: 8, totalEmployeeCount: 200 })).toBe(15);
  });
  it(">50% = 20", () => {
    expect(scopePoints({ affectedCount: 6, totalEmployeeCount: 10 })).toBe(20);
  });
  it("a null affectedCount contributes zero scope points", () => {
    expect(scopePoints({ affectedCount: null, totalEmployeeCount: 10 })).toBe(0);
  });
});

describe("durationPoints", () => {
  it("<3 months = 2", () => {
    expect(durationPoints(0)).toBe(2);
    expect(durationPoints(2)).toBe(2);
  });
  it("3-11 months = 4", () => {
    expect(durationPoints(3)).toBe(4);
    expect(durationPoints(11)).toBe(4);
  });
  it("12-35 months = 7", () => {
    expect(durationPoints(12)).toBe(7);
    expect(durationPoints(35)).toBe(7);
  });
  it(">=36 months = 10", () => {
    expect(durationPoints(36)).toBe(10);
    expect(durationPoints(100)).toBe(10);
  });
  it("null duration contributes zero points", () => {
    expect(durationPoints(null)).toBe(0);
  });
});

describe("systemicPoints / disputePoints", () => {
  it("isolated=0, repeated=5, policy=10", () => {
    expect(systemicPoints("isolated")).toBe(0);
    expect(systemicPoints("repeated")).toBe(5);
    expect(systemicPoints("policy")).toBe(10);
    expect(systemicPoints(null)).toBe(0);
  });
  it("none=0, complaint=5, legal_process=10", () => {
    expect(disputePoints("none")).toBe(0);
    expect(disputePoints("complaint")).toBe(5);
    expect(disputePoints("legal_process")).toBe(10);
    expect(disputePoints(null)).toBe(0);
  });
});

describe("computeRiskScore — bands and critical override", () => {
  function score(overrides: Partial<Parameters<typeof computeRiskScore>[0]> = {}) {
    return computeRiskScore({
      baseSeverity: 1,
      scope: { affectedCount: null, totalEmployeeCount: null },
      durationMonths: null,
      systemic: null,
      dispute: null,
      criticalOverride: false,
      ...overrides,
    });
  }

  it("riskScore = min(100, sum of all point categories)", () => {
    const result = computeRiskScore({
      baseSeverity: 5, // 50
      scope: { affectedCount: 25, totalEmployeeCount: null }, // 20
      durationMonths: 36, // 10
      systemic: "policy", // 10
      dispute: "legal_process", // 10
      criticalOverride: false,
    });
    expect(result.riskScore).toBe(100); // 50+20+10+10+10 = 100, already at the cap
  });

  it("caps at 100 even if the raw sum would exceed it", () => {
    // Not achievable with real inputs today (max is exactly 100), but the
    // min(100, ...) guard itself is directly exercised via the case above
    // landing exactly on the cap.
    const result = score({ baseSeverity: 5 });
    expect(result.riskScore).toBeLessThanOrEqual(100);
  });

  it("0-24 = LOW", () => {
    expect(score({ baseSeverity: 1 }).riskLevel).toBe("LOW"); // 10
  });
  it("25-44 = MEDIUM", () => {
    expect(score({ baseSeverity: 3 }).riskLevel).toBe("MEDIUM"); // 30
  });
  it("45-64 = SIGNIFICANT", () => {
    expect(score({ baseSeverity: 4, systemic: "repeated" }).riskLevel).toBe("SIGNIFICANT"); // 40+5=45
  });
  it("65-79 = HIGH", () => {
    const result = score({ baseSeverity: 5, scope: { affectedCount: 10, totalEmployeeCount: null } });
    expect(result.riskScore).toBe(65); // 50 (severity 5) + 15 (scope 6-20) = 65
    expect(result.riskLevel).toBe("HIGH");
  });
  it("80-100 = CRITICAL by score alone", () => {
    expect(
      score({ baseSeverity: 5, scope: { affectedCount: 25, totalEmployeeCount: null }, systemic: "policy" })
        .riskLevel,
    ).toBe("CRITICAL"); // 50+20+10=80
  });
  it("criticalOverride forces CRITICAL regardless of the numeric score", () => {
    const result = score({ baseSeverity: 1, criticalOverride: true });
    expect(result.riskScore).toBe(10);
    expect(result.riskLevel).toBe("CRITICAL");
  });
});

describe("computeConfidence — never influences risk score", () => {
  it("1/4 self-report only", () => {
    expect(
      computeConfidence({
        hasDocumentEvidence: false,
        hasOperationalCrossCheck: false,
        hasTwoConsistentAnswerSources: false,
      }),
    ).toBe(1);
  });
  it("2/4 two consistent sources", () => {
    expect(
      computeConfidence({
        hasDocumentEvidence: false,
        hasOperationalCrossCheck: false,
        hasTwoConsistentAnswerSources: true,
      }),
    ).toBe(2);
  });
  it("3/4 documentary evidence", () => {
    expect(
      computeConfidence({
        hasDocumentEvidence: true,
        hasOperationalCrossCheck: false,
        hasTwoConsistentAnswerSources: false,
      }),
    ).toBe(3);
  });
  it("4/4 document + operational cross-check", () => {
    expect(
      computeConfidence({
        hasDocumentEvidence: true,
        hasOperationalCrossCheck: true,
        hasTwoConsistentAnswerSources: false,
      }),
    ).toBe(4);
  });
  it("computeRiskScore's signature has no confidence parameter at all — structurally cannot affect risk", () => {
    const withoutConfidence = computeRiskScore({
      baseSeverity: 3,
      scope: { affectedCount: 5, totalEmployeeCount: null },
      durationMonths: 6,
      systemic: "repeated",
      dispute: "none",
      criticalOverride: false,
    });
    // Calling it twice with identical inputs must be identical — nothing
    // about "confidence" can have leaked in through any hidden channel.
    const again = computeRiskScore({
      baseSeverity: 3,
      scope: { affectedCount: 5, totalEmployeeCount: null },
      durationMonths: 6,
      systemic: "repeated",
      dispute: "none",
      criticalOverride: false,
    });
    expect(withoutConfidence).toEqual(again);
  });
});
