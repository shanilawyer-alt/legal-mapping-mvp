import { describe, expect, it } from "vitest";
import { parseCondition, tryParseCondition } from "@/domain/branching/parser";
import { evaluateCondition } from "@/domain/branching/evaluate";
import { UnparseableConditionError } from "@/domain/branching/types";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parseCsv } from "@/domain/csv/parse";
import { questionnaireRowSchema } from "@/domain/csv/schemas";
import { normalizeQuestionnaireRow } from "@/domain/questionnaire/normalize";

describe("parseCondition", () => {
  it("parses 'תמיד' and empty string as always-visible", () => {
    expect(parseCondition("תמיד")).toEqual({ type: "always" });
    expect(parseCondition("")).toEqual({ type: "always" });
  });

  it("parses a numeric greater-than clause", () => {
    expect(parseCondition("GEN-04 > 0")).toEqual({
      type: "clause",
      questionId: "GEN-04",
      operator: ">",
      values: ["0"],
    });
  });

  it("parses an equality clause with a single value", () => {
    expect(parseCondition("PRIV-08 = כן")).toEqual({
      type: "clause",
      questionId: "PRIV-08",
      operator: "=",
      values: ["כן"],
    });
  });

  it("parses '/'-separated alternatives as one-of values", () => {
    expect(parseCondition("TIME-01 = כן/חלק")).toEqual({
      type: "clause",
      questionId: "TIME-01",
      operator: "=",
      values: ["כן", "חלק"],
    });
  });

  it("parses a not-equal clause", () => {
    expect(parseCondition("EMP-06 ≠ לא")).toEqual({
      type: "clause",
      questionId: "EMP-06",
      operator: "≠",
      values: ["לא"],
    });
  });

  it("parses Hebrew 'או' (or) as a top-level OR of clauses", () => {
    expect(parseCondition("GEN-05 > 0 או GEN-04 > 0")).toEqual({
      type: "or",
      clauses: [
        { type: "clause", questionId: "GEN-05", operator: ">", values: ["0"] },
        { type: "clause", questionId: "GEN-04", operator: ">", values: ["0"] },
      ],
    });
  });

  it("parses the 'כולל' (includes) operator", () => {
    expect(parseCondition("TIME-07 כולל שעות נוספות גלובליות")).toEqual({
      type: "clause",
      questionId: "TIME-07",
      operator: "כולל",
      values: ["שעות נוספות גלובליות"],
    });
  });

  it("throws UnparseableConditionError on garbage input", () => {
    expect(() => parseCondition("this is not a condition")).toThrow(
      UnparseableConditionError,
    );
  });

  it("throws on a non-numeric '>' value", () => {
    expect(() => parseCondition("GEN-04 > many")).toThrow(UnparseableConditionError);
  });

  it("tryParseCondition returns null instead of throwing", () => {
    expect(tryParseCondition("garbage")).toBeNull();
    expect(tryParseCondition("GEN-04 > 0")).not.toBeNull();
  });
});

describe("evaluateCondition", () => {
  it("always-node is always true", () => {
    expect(evaluateCondition({ type: "always" }, {})).toBe(true);
  });

  it("evaluates numeric > against a numeric answer", () => {
    const node = parseCondition("GEN-04 > 0");
    expect(evaluateCondition(node, { "GEN-04": 3 })).toBe(true);
    expect(evaluateCondition(node, { "GEN-04": 0 })).toBe(false);
    expect(evaluateCondition(node, { "GEN-04": "5" })).toBe(true);
  });

  it("treats an unanswered dependency as condition-not-met", () => {
    const node = parseCondition("GEN-04 > 0");
    expect(evaluateCondition(node, {})).toBe(false);
    expect(evaluateCondition(node, { "GEN-04": null })).toBe(false);

    const neq = parseCondition("EMP-06 ≠ לא");
    expect(evaluateCondition(neq, {})).toBe(false);
  });

  it("evaluates equality against a scalar answer", () => {
    const node = parseCondition("PRIV-08 = כן");
    expect(evaluateCondition(node, { "PRIV-08": "כן" })).toBe(true);
    expect(evaluateCondition(node, { "PRIV-08": "לא" })).toBe(false);
  });

  it("evaluates one-of equality", () => {
    const node = parseCondition("TIME-01 = כן/חלק");
    expect(evaluateCondition(node, { "TIME-01": "חלק" })).toBe(true);
    expect(evaluateCondition(node, { "TIME-01": "לא" })).toBe(false);
  });

  it("evaluates not-equal", () => {
    const node = parseCondition("PRIV-19 ≠ אין");
    expect(evaluateCondition(node, { "PRIV-19": ["GPS"] })).toBe(true);
    expect(evaluateCondition(node, { "PRIV-19": ["אין"] })).toBe(false);
  });

  it("evaluates OR across two clauses", () => {
    const node = parseCondition("GEN-05 > 0 או GEN-04 > 0");
    expect(evaluateCondition(node, { "GEN-05": 0, "GEN-04": 1 })).toBe(true);
    expect(evaluateCondition(node, { "GEN-05": 0, "GEN-04": 0 })).toBe(false);
  });

  it("evaluates 'כולל' (includes) against a multi-select answer array", () => {
    const node = parseCondition("TIME-07 כולל שעות נוספות גלובליות");
    expect(
      evaluateCondition(node, { "TIME-07": ["רכיב שעות נוספות גלובלי", "כלולות בשכר החודשי"] }),
    ).toBe(false); // exact value must match one of the parsed values
    expect(
      evaluateCondition(node, { "TIME-07": ["שעות נוספות גלובליות"] }),
    ).toBe(true);
  });
});

describe("every real questionnaire.csv trigger parses and evaluates without throwing", () => {
  const csvText = readFileSync(join(__dirname, "..", "data", "questionnaire.csv"), "utf-8");
  const { rows, errors } = parseCsv(csvText, questionnaireRowSchema);

  it("has zero row-level validation errors", () => {
    expect(errors).toEqual([]);
  });

  it("normalizes every row (including trigger parsing) without throwing", () => {
    for (const row of rows) {
      expect(() => normalizeQuestionnaireRow(row)).not.toThrow();
    }
  });

  it("evaluates every trigger against an empty answer set without throwing", () => {
    const items = rows.map(normalizeQuestionnaireRow);
    for (const item of items) {
      expect(() => evaluateCondition(item.triggerCondition, {})).not.toThrow();
    }
  });
});
