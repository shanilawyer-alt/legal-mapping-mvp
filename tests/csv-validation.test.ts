import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { parseCsv } from "@/domain/csv/parse";
import {
  documentAnalysisRowSchema,
  exposureFactorRowSchema,
  freelancerScreeningRowSchema,
  legalSourceRowSchema,
  questionnaireRowSchema,
  reportStructureRowSchema,
  ruleCatalogRowSchema,
} from "@/domain/csv/schemas";
import { findDanglingQuestionRefs, findDuplicateIds } from "@/domain/csv/referential";

const DATA_DIR = join(__dirname, "..", "data");
const readCsv = (filename: string) => readFileSync(join(DATA_DIR, filename), "utf-8");

describe("real CSV files parse and validate cleanly", () => {
  const cases: Array<[string, z.ZodTypeAny, number]> = [
    ["questionnaire.csv", questionnaireRowSchema, 103],
    ["rule_catalog.csv", ruleCatalogRowSchema, 42],
    ["freelancer_screening_model.csv", freelancerScreeningRowSchema, 14],
    ["exposure_factors.csv", exposureFactorRowSchema, 23],
    ["document_analysis_matrix.csv", documentAnalysisRowSchema, 8],
    ["report_structure.csv", reportStructureRowSchema, 12],
    ["legal_sources.csv", legalSourceRowSchema, 15],
  ];

  for (const [filename, schema, expectedRowCount] of cases) {
    it(`${filename}: ${expectedRowCount} rows, zero validation errors`, () => {
      const { rows, errors } = parseCsv(readCsv(filename), schema);
      expect(errors).toEqual([]);
      expect(rows).toHaveLength(expectedRowCount);
    });
  }
});

describe("questionnaire.csv referential integrity", () => {
  const { rows } = parseCsv(readCsv("questionnaire.csv"), questionnaireRowSchema);
  const ids = rows.map((r) => r.ID);

  it("has no duplicate question IDs", () => {
    expect(findDuplicateIds(ids)).toEqual([]);
  });

  it("every ID matches the PREFIX-NN shape", () => {
    for (const id of ids) {
      expect(id).toMatch(/^[A-Z]+-\d+$/);
    }
  });
});

describe("rule_catalog.csv referential integrity", () => {
  const { rows: questionRows } = parseCsv(readCsv("questionnaire.csv"), questionnaireRowSchema);
  const { rows: docRows } = parseCsv(
    readCsv("document_analysis_matrix.csv"),
    documentAnalysisRowSchema,
  );
  const { rows: ruleRows } = parseCsv(readCsv("rule_catalog.csv"), ruleCatalogRowSchema);

  const knownIds = new Set([
    ...questionRows.map((r) => r.ID),
    ...docRows.map((r) => r.ID),
  ]);

  it("has no duplicate Rule IDs", () => {
    expect(findDuplicateIds(ruleRows.map((r) => r["Rule ID"]))).toEqual([]);
  });

  it("every rule's קלטים (inputs) reference a known question or document ID", () => {
    for (const row of ruleRows) {
      const dangling = findDanglingQuestionRefs(row["קלטים"], knownIds, row["Rule ID"]);
      expect(dangling).toEqual([]);
    }
  });

  it("every rule's base severity (חומרה בסיסית 1-5) is an integer 1-5", () => {
    for (const row of ruleRows) {
      const severity = Number(row["חומרה בסיסית 1-5"]);
      expect(Number.isInteger(severity)).toBe(true);
      expect(severity).toBeGreaterThanOrEqual(1);
      expect(severity).toBeLessThanOrEqual(5);
    }
  });
});

describe("freelancer_screening_model.csv referential integrity", () => {
  const { rows: questionRows } = parseCsv(readCsv("questionnaire.csv"), questionnaireRowSchema);
  const knownQuestionIds = new Set(questionRows.map((r) => r.ID));
  const { rows } = parseCsv(readCsv("freelancer_screening_model.csv"), freelancerScreeningRowSchema);

  it("every row's שאלה references a known question ID", () => {
    for (const row of rows) {
      const dangling = findDanglingQuestionRefs(row["שאלה"], knownQuestionIds, row["שאלה"]);
      expect(dangling).toEqual([]);
    }
  });
});

describe("document_analysis_matrix.csv referential integrity", () => {
  const { rows: questionRows } = parseCsv(readCsv("questionnaire.csv"), questionnaireRowSchema);
  const knownQuestionIds = new Set(questionRows.map((r) => r.ID));
  const { rows } = parseCsv(readCsv("document_analysis_matrix.csv"), documentAnalysisRowSchema);

  it("has no duplicate document IDs", () => {
    expect(findDuplicateIds(rows.map((r) => r.ID))).toEqual([]);
  });

  it("every row's שאלות מקושרות references a known question ID", () => {
    for (const row of rows) {
      const dangling = findDanglingQuestionRefs(row["שאלות מקושרות"], knownQuestionIds, row.ID);
      expect(dangling).toEqual([]);
    }
  });
});

describe("parseCsv row validation (synthetic negative cases)", () => {
  it("reports a missing required column instead of throwing", () => {
    const badCsv = "ID,תחום\nGEN-01,פרופיל העסק\n"; // missing required columns
    const { rows, errors } = parseCsv(badCsv, questionnaireRowSchema);
    expect(rows).toHaveLength(0);
    expect(errors.length).toBeGreaterThan(0);
    expect(errors[0].rowNumber).toBe(1);
  });

  it("accepts a row with only required columns present, others blank", () => {
    const csv =
      'ID,תחום,תת-תחום,נוסח השאלה ללקוח,סוג תשובה,אפשרויות / פורמט,מתי מוצג (Trigger),שאלת המשך / פעולה,מסמך להעלאה,בדיקה פנימית בשלב הניתוח,שירות/צורך שעשוי להתגלות,ליבה/מותנה\nGEN-99,פרופיל העסק,,שאלה לדוגמה?,טקסט קצר,,,,,,,ליבה\n';
    const { rows, errors } = parseCsv(csv, questionnaireRowSchema);
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(1);
  });
});
