import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/domain/csv/parse";
import { ruleCatalogRowSchema } from "@/domain/csv/schemas";
import { RULE_CATALOG } from "@/domain/rules/catalog";
import { validateRuleCatalog } from "@/domain/rules/validateCatalog";

/**
 * Cross-checks the 42 hand-translated `RULE_CATALOG` entries against the
 * real `rule_catalog.csv` — Rule IDs, severities, critical-override
 * flags, automation levels, and condition text must never silently
 * drift from the source (PHASE_3_PLAN.md §4/§1, OPEN_QUESTIONS.md
 * item 21). Mirrors the Phase 1 pattern in tests/branching.test.ts.
 */
describe("RULE_CATALOG matches rule_catalog.csv exactly", () => {
  const csvText = readFileSync(join(__dirname, "..", "data", "rule_catalog.csv"), "utf-8");
  const { rows, errors } = parseCsv(csvText, ruleCatalogRowSchema);

  it("has zero row-level validation errors in the real CSV", () => {
    expect(errors).toEqual([]);
  });

  it("has exactly 42 rows", () => {
    expect(rows).toHaveLength(42);
  });

  it("RULE_CATALOG has zero validation issues against the real CSV", () => {
    const issues = validateRuleCatalog(RULE_CATALOG, rows);
    expect(issues).toEqual([]);
  });

  it("has exactly the same 42 Rule IDs as the CSV, in the same order", () => {
    expect(RULE_CATALOG.map((r) => r.ruleId)).toEqual(rows.map((r) => r["Rule ID"]));
  });

  it("has no duplicate Rule IDs", () => {
    const ids = RULE_CATALOG.map((r) => r.ruleId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every base severity is an integer between 1 and 5", () => {
    for (const rule of RULE_CATALOG) {
      expect(Number.isInteger(rule.baseSeverity)).toBe(true);
      expect(rule.baseSeverity).toBeGreaterThanOrEqual(1);
      expect(rule.baseSeverity).toBeLessThanOrEqual(5);
    }
  });

  it("every rule with alwaysRequiresManualReview never auto-matches, for any input", () => {
    const alwaysManual = RULE_CATALOG.filter((r) => r.alwaysRequiresManualReview);
    expect(alwaysManual.length).toBeGreaterThan(0);
    for (const rule of alwaysManual) {
      // Try a battery of fact maps designed to make most conditions true.
      expect(rule.evaluate({})).toBe(false);
      expect(rule.evaluate({ "answer.GEN-04": 999 })).toBe(false);
      expect(
        rule.evaluate(
          Object.fromEntries(rule.inputs.map((i) => [`answer.${i}`, "כן"])),
        ),
      ).toBe(false);
    }
  });

  it("every Manual-automation-level rule (per the CSV) is flagged alwaysRequiresManualReview", () => {
    for (const rule of RULE_CATALOG) {
      if (rule.automationLevel === "Manual") {
        expect(rule.alwaysRequiresManualReview).toBe(true);
      }
    }
  });
});
