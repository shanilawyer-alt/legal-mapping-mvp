import { describe, expect, it } from "vitest";
import { RULE_CATALOG, RULE_CATALOG_BY_ID } from "@/domain/rules/catalog";
import { evaluateRules } from "@/domain/rules/evaluate";
import type { FactMap } from "@/domain/facts/types";

/**
 * One positive (matching) and one negative (non-matching) fact map per
 * decidable rule, plus determinism/traceability tests. The 6 rules that
 * never auto-match (`alwaysRequiresManualReview`) are covered separately
 * in tests/rule-catalog-validation.test.ts, not duplicated here.
 */
const CASES: Record<string, { matching: FactMap; nonMatching: FactMap }> = {
  "R-EMP-001": {
    matching: { "answer.EMP-01": "לא", "answer.EMP-02": "לא" },
    nonMatching: { "answer.EMP-01": "כן, עם כולם", "answer.EMP-02": "לא" },
  },
  "R-EMP-002": {
    matching: { "answer.EMP-02": "לא", "answer.EMP-01": "כן, עם כולם" },
    nonMatching: { "answer.EMP-02": "כן, לכולם", "answer.EMP-01": "כן, עם כולם" },
  },
  "R-EMP-003": {
    matching: { "answer.EMP-04": "כן", "answer.EMP-05": "לפעמים" },
    nonMatching: { "answer.EMP-04": "לא", "answer.EMP-05": "לפעמים" },
  },
  "R-TIME-001": {
    matching: { "answer.TIME-01": "רק חלק מהעובדים" },
    nonMatching: { "answer.TIME-01": "כן, כולם" },
  },
  "R-TIME-002": {
    matching: {
      "answer.TIME-06": "כן, באופן קבוע",
      "answer.TIME-07": ["כלולות בשכר החודשי"],
    },
    nonMatching: {
      "answer.TIME-06": "לא",
      "answer.TIME-07": ["כלולות בשכר החודשי"],
    },
  },
  "R-TIME-003": {
    matching: { "answer.TIME-07": ["רכיב שעות נוספות גלובלי"], "answer.TIME-08": "לא" },
    nonMatching: { "answer.TIME-07": ["רכיב שעות נוספות גלובלי"], "answer.TIME-08": "כן" },
  },
  "R-TIME-004": {
    matching: { "answer.TIME-13": "כן" },
    nonMatching: { "answer.TIME-13": "לא" },
  },
  "R-TIME-005": {
    matching: { "answer.TIME-14": "כן, באופן קבוע" },
    nonMatching: { "answer.TIME-14": "לא" },
  },
  "R-TIME-006": {
    matching: { "answer.TIME-15": "כן" },
    nonMatching: { "answer.TIME-15": "לא" },
  },
  "R-SOC-001": {
    matching: { "answer.SOC-01": "לא" },
    nonMatching: { "answer.SOC-01": "כן" },
  },
  "R-SOC-002": {
    matching: { "answer.SOC-02": "לפעמים" },
    nonMatching: { "answer.SOC-02": "תמיד" },
  },
  "R-SOC-003": {
    matching: { "answer.SOC-05": "כן" },
    nonMatching: { "answer.SOC-05": "לא" },
  },
  "R-PAY-001": {
    matching: { "answer.PAY-01": "כן", "answer.PAY-04": "לא" },
    nonMatching: { "answer.PAY-01": "לא", "answer.PAY-04": "לא" },
  },
  "R-PAY-002": {
    matching: { "cross_check.pay.contract_payslip_mismatch": true },
    nonMatching: { "cross_check.pay.contract_payslip_mismatch": false },
  },
  "R-TERM-001": {
    matching: { "answer.TERM-01": "כן", "answer.TERM-02": "לא" },
    nonMatching: { "answer.TERM-01": "לא", "answer.TERM-02": "לא" },
  },
  "R-TERM-002": {
    matching: { "answer.TERM-03": "לפעמים" },
    nonMatching: { "answer.TERM-03": "תמיד" },
  },
  "R-TERM-003": {
    matching: { "answer.TERM-04": "לא" },
    nonMatching: { "answer.TERM-04": "תמיד" },
  },
  "R-TERM-004": {
    matching: { "answer.TERM-05": "לפני השימוע" },
    nonMatching: { "answer.TERM-05": "במהלך השימוע" },
  },
  "R-TERM-005": {
    matching: { "answer.TERM-06": "כן", "answer.TERM-07": "כן" },
    nonMatching: { "answer.TERM-06": "לא", "answer.TERM-07": "כן" },
  },
  "R-HR-001": {
    matching: { "answer.HR-02": "לא" },
    nonMatching: { "answer.HR-02": "כן" },
  },
  "R-HR-002": {
    matching: { "answer.GEN-04": 30, "answer.HR-04": "לא" },
    nonMatching: { "answer.GEN-04": 10, "answer.HR-04": "לא" },
  },
  "R-PRIV-001": {
    matching: { "answer.PRIV-03": "לא" },
    nonMatching: { "answer.PRIV-03": "כן, מדיניות/הודעת פרטיות נפרדת" },
  },
  "R-PRIV-003": {
    matching: { "answer.PRIV-05": "כן" },
    nonMatching: { "answer.PRIV-05": "לא" },
  },
  "R-PRIV-004": {
    matching: { "answer.PRIV-06": ["IT"], "answer.PRIV-07": "לא" },
    nonMatching: { "answer.PRIV-06": ["אין"], "answer.PRIV-07": "לא" },
  },
  "R-CAM-001": {
    matching: { "answer.PRIV-09": ["חדר הלבשה"] },
    nonMatching: { "answer.PRIV-09": ["כניסה/יציאה"] },
  },
  "R-CAM-002": {
    matching: { "answer.PRIV-08": "כן", "answer.PRIV-11": "לא" },
    nonMatching: { "answer.PRIV-08": "לא", "answer.PRIV-11": "לא" },
  },
  "R-CAM-003": {
    matching: { "answer.PRIV-12": "לא" },
    nonMatching: { "answer.PRIV-12": "כן" },
  },
  "R-CAM-004": {
    matching: { "answer.PRIV-13": "כן" },
    nonMatching: { "answer.PRIV-13": "לא" },
  },
  "R-CAM-005": {
    matching: { "answer.PRIV-16": "כן" },
    nonMatching: { "answer.PRIV-16": "לא" },
  },
  "R-CAM-006": {
    matching: { "answer.PRIV-15": "מעל 90 ימים" },
    nonMatching: { "answer.PRIV-15": "עד 7 ימים" },
  },
  "R-BIO-001": {
    matching: { "answer.PRIV-17": "כן", "answer.PRIV-18": "לא" },
    nonMatching: { "answer.PRIV-17": "לא", "answer.PRIV-18": "לא" },
  },
  "R-MON-001": {
    matching: { "answer.PRIV-19": ["GPS/איתור רכב"], "answer.PRIV-21": "לא" },
    nonMatching: { "answer.PRIV-19": ["אין"], "answer.PRIV-21": "לא" },
  },
  "R-MON-002": {
    matching: { "answer.PRIV-22": "כן" },
    nonMatching: { "answer.PRIV-22": "לא" },
  },
  "R-EMAIL-001": {
    matching: { "answer.PRIV-23": "לא" },
    nonMatching: { "answer.PRIV-23": "כן" },
  },
  "R-OFF-001": {
    matching: { "answer.PRIV-24": "לא באופן קבוע" },
    nonMatching: { "answer.PRIV-24": "מיד עם הסיום" },
  },
  "R-OFF-002": {
    matching: { "answer.PRIV-25": "מועברת למנהל" },
    nonMatching: { "answer.PRIV-25": "נסגרת" },
  },
  "R-RET-001": {
    matching: { "answer.PRIV-26": "לא" },
    nonMatching: { "answer.PRIV-26": "כן" },
  },
};

describe("RULE_CATALOG per-rule evaluation (positive + negative case per decidable rule)", () => {
  for (const [ruleId, { matching, nonMatching }] of Object.entries(CASES)) {
    const rule = RULE_CATALOG_BY_ID.get(ruleId);
    it(`${ruleId}: matches its documented positive case`, () => {
      expect(rule).toBeDefined();
      expect(rule!.evaluate(matching)).toBe(true);
    });
    it(`${ruleId}: does not match its documented negative case`, () => {
      expect(rule!.evaluate(nonMatching)).toBe(false);
    });
  }

  it("covers every decidable (non-alwaysRequiresManualReview) rule with at least one case", () => {
    const decidableRuleIds = RULE_CATALOG.filter((r) => !r.alwaysRequiresManualReview).map(
      (r) => r.ruleId,
    );
    for (const ruleId of decidableRuleIds) {
      expect(CASES).toHaveProperty(ruleId);
    }
  });
});

describe("evaluateRules — determinism and traceability", () => {
  it("is a pure function: the same facts always produce the same results, run repeatedly", () => {
    const facts: FactMap = { "answer.EMP-01": "לא", "answer.EMP-02": "לא", "answer.GEN-04": 30 };
    const first = evaluateRules(facts);
    const second = evaluateRules(facts);
    const third = evaluateRules(facts);
    expect(first).toEqual(second);
    expect(second).toEqual(third);
  });

  it("produces exactly one result per catalog rule, in catalog order", () => {
    const results = evaluateRules({});
    expect(results).toHaveLength(RULE_CATALOG.length);
    expect(results.map((r) => r.ruleId)).toEqual(RULE_CATALOG.map((r) => r.ruleId));
  });

  it("never matches anything against an empty fact map", () => {
    const results = evaluateRules({});
    expect(results.every((r) => r.matched === false)).toBe(true);
  });

  it("carries baseSeverity/criticalOverride straight from the rule definition, unmodified", () => {
    const results = evaluateRules({ "answer.TERM-05": "לפני השימוע" });
    const termResult = results.find((r) => r.ruleId === "R-TERM-004")!;
    expect(termResult.matched).toBe(true);
    expect(termResult.baseSeverity).toBe(5);
    expect(termResult.criticalOverride).toBe(true);
  });

  it("inputSnapshot captures only this rule's declared inputs, not the whole fact bundle", () => {
    const facts: FactMap = {
      "answer.EMP-01": "לא",
      "answer.EMP-02": "לא",
      "answer.TIME-13": "כן", // unrelated to R-EMP-001
    };
    const results = evaluateRules(facts);
    const empResult = results.find((r) => r.ruleId === "R-EMP-001")!;
    expect(empResult.inputSnapshot).toEqual({
      "answer.EMP-01": "לא",
      "answer.EMP-02": "לא",
    });
  });

  it("captures a cross-check fact key directly in inputSnapshot (R-PAY-002)", () => {
    const results = evaluateRules({ "cross_check.pay.contract_payslip_mismatch": true });
    const payResult = results.find((r) => r.ruleId === "R-PAY-002")!;
    expect(payResult.matched).toBe(true);
    expect(payResult.inputSnapshot["cross_check.pay.contract_payslip_mismatch"]).toBe(true);
  });

  it("flags requiresManualReview only for alwaysRequiresManualReview rules", () => {
    const results = evaluateRules({});
    for (const result of results) {
      const rule = RULE_CATALOG_BY_ID.get(result.ruleId)!;
      expect(result.requiresManualReview).toBe(rule.alwaysRequiresManualReview === true);
    }
  });

  it("Rule IDs in results exactly match rule_catalog.csv's 42 IDs — no drift, no invented rules", () => {
    const results = evaluateRules({});
    expect(results).toHaveLength(42);
    expect(new Set(results.map((r) => r.ruleId)).size).toBe(42);
  });
});
