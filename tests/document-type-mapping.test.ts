import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/domain/csv/parse";
import { documentAnalysisRowSchema } from "@/domain/csv/schemas";
import { loadQuestionnaire } from "@/domain/questionnaire/load";
import {
  applyDocumentTypeMapping,
  DOCUMENT_TYPE_BY_QUESTION_ID,
  validateDocumentTypeMapping,
} from "@/domain/questionnaire/documentTypeMapping";

describe("validateDocumentTypeMapping — zero drift against the real document_analysis_matrix.csv", () => {
  it("the compiled questionnaire (post-mapping, as loadQuestionnaire() serves it) has no remaining issues", () => {
    const items = loadQuestionnaire();
    const csvText = readFileSync(join(__dirname, "..", "data", "document_analysis_matrix.csv"), "utf-8");
    const { rows, errors } = parseCsv(csvText, documentAnalysisRowSchema);
    expect(errors).toEqual([]);
    expect(validateDocumentTypeMapping(items, rows)).toEqual([]);
  });
});

describe("applyDocumentTypeMapping — resolves all 7 document-upload questions to their real DOC ID", () => {
  it("maps every entry in DOCUMENT_TYPE_BY_QUESTION_ID", () => {
    const items = loadQuestionnaire();
    const byId = new Map(items.map((i) => [i.id, i]));
    for (const [questionId, expectedDocId] of Object.entries(DOCUMENT_TYPE_BY_QUESTION_ID)) {
      expect(byId.get(questionId)?.documentTypeId).toBe(expectedDocId);
    }
  });

  it("EMP-01 -> DOC-01, EMP-02 -> DOC-02, TIME-05 -> DOC-04, PAY-04 -> DOC-05, FR-01 -> DOC-06, PRIV-03 -> DOC-07, HR-04 -> DOC-08", () => {
    const items = loadQuestionnaire();
    const byId = new Map(items.map((i) => [i.id, i]));
    expect(byId.get("EMP-01")?.documentTypeId).toBe("DOC-01");
    expect(byId.get("EMP-02")?.documentTypeId).toBe("DOC-02");
    expect(byId.get("TIME-05")?.documentTypeId).toBe("DOC-04");
    expect(byId.get("PAY-04")?.documentTypeId).toBe("DOC-05");
    expect(byId.get("FR-01")?.documentTypeId).toBe("DOC-06");
    expect(byId.get("PRIV-03")?.documentTypeId).toBe("DOC-07");
    expect(byId.get("HR-04")?.documentTypeId).toBe("DOC-08");
  });

  it("LIT-02 (an optional litigation filing, no DOC-01..DOC-08 category exists for it) stays unmapped, unchanged behavior", () => {
    const items = loadQuestionnaire();
    const lit02 = items.find((i) => i.id === "LIT-02")!;
    expect(lit02.documentRequest).not.toBe("");
    expect(lit02.documentTypeId).toBeNull();
  });

  it("every other item's documentTypeId is null", () => {
    const items = loadQuestionnaire();
    for (const item of items) {
      if (DOCUMENT_TYPE_BY_QUESTION_ID[item.id]) continue;
      expect(item.documentTypeId).toBeNull();
    }
  });

  it("is idempotent", () => {
    const items = loadQuestionnaire();
    const once = applyDocumentTypeMapping(items);
    const twice = applyDocumentTypeMapping(once);
    expect(twice).toEqual(once);
  });

  it("detects a synthetic drift when a mapped DOC ID no longer exists in the CSV (proves the checker works)", () => {
    const items = loadQuestionnaire();
    const fakeDocRows = [{ ID: "DOC-99", "סוג מסמך": "x", "מה מבקשים מהלקוח": "x", "מה ה-AI מחלץ/בודק": "", "שאלות מקושרות": "", "הערה משפטית": "" }];
    const issues = validateDocumentTypeMapping(items, fakeDocRows as never);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.some((i) => i.questionId === "EMP-01")).toBe(true);
  });
});
