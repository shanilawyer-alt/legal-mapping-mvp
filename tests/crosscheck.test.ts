import { describe, expect, it } from "vitest";
import type { FactMap } from "@/domain/facts/types";
import type { DocumentExtraction } from "@/lib/db/types";
import { createSyntheticExtractor } from "@/domain/extraction/syntheticProvider";
import { flattenExtractionToFacts } from "@/domain/crosscheck/normalizeExtraction";
import { crossCheckGlobalOvertime } from "@/domain/crosscheck/globalOvertime";
import { crossCheckEmployeeNotice } from "@/domain/crosscheck/employeeNotice";
import { crossCheckPrivacy } from "@/domain/crosscheck/privacyContradiction";
import { crossCheckFreelancerAggregation } from "@/domain/crosscheck/freelancerAggregation";
import { runCrossChecks } from "@/domain/crosscheck";
import { evaluateRules } from "@/domain/rules/evaluate";
import { RULE_CATALOG_BY_ID } from "@/domain/rules/catalog";

const extractor = createSyntheticExtractor();

async function extractAs(
  documentType: string,
  fixtureTag: string,
  id: string,
  documentId: string,
): Promise<DocumentExtraction> {
  const outcome = await extractor.extract({
    documentId,
    documentType,
    storagePath: `assessment-1/${documentId}`,
    sha256: "irrelevant-in-synthetic-mode",
    fixtureTag,
  });
  return {
    id,
    documentId,
    schemaName: outcome.schemaName,
    schemaVersion: outcome.schemaVersion,
    provider: outcome.provider,
    model: outcome.model,
    extractionJson: outcome.extractionJson,
    confidenceJson: outcome.confidenceJson,
    evidenceJson: outcome.evidenceJson,
    status: outcome.status,
    createdAt: new Date().toISOString(),
  };
}

describe("flattenExtractionToFacts", () => {
  it("flattens a completed extraction into document_extraction.<schemaName>.<field> facts", async () => {
    const extraction = await extractAs("DOC-01", "B-overtime-mismatch", "ext-1", "doc-1");
    const facts = flattenExtractionToFacts(extraction, "assessment-1");
    const overtimeType = facts.find((f) => f.factKey === "document_extraction.employment_agreement.overtimeType");
    expect(overtimeType?.valueJson).toBe("global");
    expect(overtimeType?.sourceType).toBe("document_extraction");
    expect(overtimeType?.sourceId).toBe("ext-1");
    expect(overtimeType?.confidence).toBe(3);
  });

  it("produces no facts for a failed extraction — uncertainty never becomes a fact value", async () => {
    const outcome = await extractor.extract({
      documentId: "doc-2",
      documentType: "DOC-01",
      storagePath: "p",
      sha256: "s",
    });
    const extraction: DocumentExtraction = {
      id: "ext-2",
      documentId: "doc-2",
      schemaName: outcome.schemaName,
      schemaVersion: outcome.schemaVersion,
      provider: outcome.provider,
      model: outcome.model,
      extractionJson: outcome.extractionJson,
      confidenceJson: outcome.confidenceJson,
      evidenceJson: outcome.evidenceJson,
      status: outcome.status,
      createdAt: new Date().toISOString(),
    };
    expect(flattenExtractionToFacts(extraction, "assessment-1")).toEqual([]);
  });
});

describe("crossCheckGlobalOvertime — demonstration 2", () => {
  it("detects both the attendance mismatch and the payslip mismatch on fixture B (spec §22)", async () => {
    const doc01 = await extractAs("DOC-01", "B-overtime-mismatch", "e1", "d1");
    const doc03 = await extractAs("DOC-03", "B-overtime-mismatch", "e2", "d2");
    const doc04 = await extractAs("DOC-04", "B-overtime-mismatch", "e3", "d3");
    const facts: FactMap = Object.fromEntries(
      [doc01, doc03, doc04].flatMap((e) => flattenExtractionToFacts(e, "a1")).map((f) => [f.factKey, f.valueJson]),
    );
    const outcome = crossCheckGlobalOvertime(facts);
    expect(outcome.facts["cross_check.time.global_overtime_attendance_mismatch"]).toBe(true);
    expect(outcome.facts["cross_check.pay.contract_payslip_mismatch"]).toBe(true);
    expect(outcome.issues).toHaveLength(2);
  });

  it("finds no mismatch on fixture A (no global overtime clause)", async () => {
    const doc01 = await extractAs("DOC-01", "A-clean", "e1", "d1");
    const facts: FactMap = Object.fromEntries(
      flattenExtractionToFacts(doc01, "a1").map((f) => [f.factKey, f.valueJson]),
    );
    const outcome = crossCheckGlobalOvertime(facts);
    expect(outcome.facts["cross_check.time.global_overtime_attendance_mismatch"]).toBe(false);
    expect(outcome.facts["cross_check.pay.contract_payslip_mismatch"]).toBe(false);
    expect(outcome.issues).toEqual([]);
  });

  it("is deterministic", async () => {
    const doc01 = await extractAs("DOC-01", "B-overtime-mismatch", "e1", "d1");
    const doc04 = await extractAs("DOC-04", "B-overtime-mismatch", "e3", "d3");
    const facts: FactMap = Object.fromEntries(
      [doc01, doc04].flatMap((e) => flattenExtractionToFacts(e, "a1")).map((f) => [f.factKey, f.valueJson]),
    );
    expect(crossCheckGlobalOvertime(facts)).toEqual(crossCheckGlobalOvertime(facts));
  });
});

describe("crossCheckEmployeeNotice — demonstration 1", () => {
  it("flags requires_attorney_review when an agreement exists but notice is missing (EMP-02 internal-check column, questionnaire.csv)", () => {
    const outcome = crossCheckEmployeeNotice({ "answer.EMP-01": "כן, עם כולם", "answer.EMP-02": "לא" });
    expect(outcome.facts["cross_check.employee_notice.requires_contract_coverage_check"]).toBe(true);
    expect(outcome.issues).toHaveLength(1);
    expect(outcome.issues[0].issueType).toBe("requires_attorney_review");
  });

  it("flags when the agreement covers only part of employees and notice is only partial", () => {
    const outcome = crossCheckEmployeeNotice({ "answer.EMP-01": "רק עם חלקם", "answer.EMP-02": "רק לחלקם" });
    expect(outcome.facts["cross_check.employee_notice.requires_contract_coverage_check"]).toBe(true);
  });

  it("does not flag when a full notice was given", () => {
    const outcome = crossCheckEmployeeNotice({ "answer.EMP-01": "כן, עם כולם", "answer.EMP-02": "כן, לכולם" });
    expect(outcome.facts["cross_check.employee_notice.requires_contract_coverage_check"]).toBe(false);
    expect(outcome.issues).toEqual([]);
  });

  it("does not flag when no agreement exists at all (nothing to check for coverage)", () => {
    const outcome = crossCheckEmployeeNotice({ "answer.EMP-01": "לא", "answer.EMP-02": "לא" });
    expect(outcome.facts["cross_check.employee_notice.requires_contract_coverage_check"]).toBe(false);
  });
});

describe("crossCheckPrivacy — demonstration 3", () => {
  it("flags components_incomplete and the monitoring contradiction on fixture C (spec §22)", async () => {
    const doc07 = await extractAs("DOC-07", "C-privacy-gap", "e1", "d1");
    const extractionFacts: FactMap = Object.fromEntries(
      flattenExtractionToFacts(doc07, "a1").map((f) => [f.factKey, f.valueJson]),
    );
    const facts: FactMap = { ...extractionFacts, "answer.PRIV-19": ["אין"] };
    const outcome = crossCheckPrivacy(facts);
    expect(outcome.facts["document_extraction.privacy_notice.components_incomplete"]).toBe(true);
    expect(outcome.facts["cross_check.privacy.location_monitoring_contradiction"]).toBe(true);
    expect(outcome.issues).toHaveLength(2);
  });

  it("does not flag a contradiction when the client also reports monitoring means", async () => {
    const doc07 = await extractAs("DOC-07", "C-privacy-gap", "e1", "d1");
    const extractionFacts: FactMap = Object.fromEntries(
      flattenExtractionToFacts(doc07, "a1").map((f) => [f.factKey, f.valueJson]),
    );
    const facts: FactMap = { ...extractionFacts, "answer.PRIV-19": ["GPS/איתור רכב"] };
    const outcome = crossCheckPrivacy(facts);
    expect(outcome.facts["cross_check.privacy.location_monitoring_contradiction"]).toBe(false);
  });

  it("does not flag components_incomplete when every required component is present", () => {
    const facts: FactMap = {
      "document_extraction.privacy_notice.purposes": "אבטחה",
      "document_extraction.privacy_notice.mandatoryOrVoluntary": "רשות",
      "document_extraction.privacy_notice.dataCategories": "פרטי קשר",
      "document_extraction.privacy_notice.recipients": "אין העברות",
      "document_extraction.privacy_notice.controllerIdentity": "החברה בע\"מ",
      "document_extraction.privacy_notice.controllerContact": "dpo@example.com",
      "document_extraction.privacy_notice.rightsDescribed": true,
    };
    const outcome = crossCheckPrivacy(facts);
    expect(outcome.facts["document_extraction.privacy_notice.components_incomplete"]).toBe(false);
  });
});

describe("crossCheckFreelancerAggregation — demonstration 4", () => {
  it("surfaces requires_attorney_review with the mandatory disclosure when indicators contribute", () => {
    const outcome = crossCheckFreelancerAggregation({ "answer.FR-04": "לא", "answer.FR-07": "כן" });
    expect(outcome.facts["cross_check.freelancer.screening_indicators_present"]).toBe(true);
    expect(outcome.issues).toHaveLength(1);
    expect(outcome.issues[0].description).toContain(
      "does not determine the legal status of the service provider",
    );
  });

  it("surfaces nothing from an empty fact map", () => {
    const outcome = crossCheckFreelancerAggregation({});
    expect(outcome.facts["cross_check.freelancer.screening_indicators_present"]).toBe(false);
    expect(outcome.issues).toEqual([]);
  });
});

describe("runCrossChecks — full orchestration", () => {
  it("produces a factMap the Rule Engine can consume, matching R-TIME-003/R-PAY-002 on fixture B", async () => {
    const doc01 = await extractAs("DOC-01", "B-overtime-mismatch", "e1", "d1");
    const doc03 = await extractAs("DOC-03", "B-overtime-mismatch", "e2", "d2");
    const doc04 = await extractAs("DOC-04", "B-overtime-mismatch", "e3", "d3");
    const baseFacts: FactMap = { "answer.TIME-07": ["רכיב שעות נוספות גלובלי"], "answer.TIME-08": "לא יודעת" };

    const result = runCrossChecks(baseFacts, [doc01, doc03, doc04], "assessment-1");

    expect(result.factMap["cross_check.time.global_overtime_attendance_mismatch"]).toBe(true);
    expect(result.factMap["cross_check.pay.contract_payslip_mismatch"]).toBe(true);

    const evaluations = evaluateRules(result.factMap);
    const timeResult = evaluations.find((r) => r.ruleId === "R-TIME-003");
    const payResult = evaluations.find((r) => r.ruleId === "R-PAY-002");
    expect(timeResult?.matched).toBe(true);
    expect(payResult?.matched).toBe(true);
    expect(RULE_CATALOG_BY_ID.get("R-TIME-003")).toBeDefined();
  });

  it("newFacts includes both extraction-derived and cross-check-derived rows with correct sourceType", async () => {
    const doc01 = await extractAs("DOC-01", "B-overtime-mismatch", "e1", "d1");
    const doc04 = await extractAs("DOC-04", "B-overtime-mismatch", "e3", "d3");
    const result = runCrossChecks({}, [doc01, doc04], "assessment-1");

    const extractionDerived = result.newFacts.filter((f) => f.sourceType === "document_extraction");
    const crossCheckDerived = result.newFacts.filter((f) => f.sourceType === "cross_check");
    expect(extractionDerived.length).toBeGreaterThan(0);
    expect(crossCheckDerived.length).toBeGreaterThan(0);
    expect(crossCheckDerived.every((f) => f.assessmentId === "assessment-1")).toBe(true);
  });

  it("cross-check results are ordinary facts, structurally separate from findings — no ruleId/severity anywhere in the output", async () => {
    const doc01 = await extractAs("DOC-01", "B-overtime-mismatch", "e1", "d1");
    const result = runCrossChecks({}, [doc01], "assessment-1");
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/"ruleId"|"severity"|"baseSeverity"/);
  });

  it("uses neutral, non-accusatory wording in every issue description across all demonstrations", async () => {
    const doc01 = await extractAs("DOC-01", "B-overtime-mismatch", "e1", "d1");
    const doc03 = await extractAs("DOC-03", "B-overtime-mismatch", "e2", "d2");
    const doc04 = await extractAs("DOC-04", "B-overtime-mismatch", "e3", "d3");
    const doc07 = await extractAs("DOC-07", "C-privacy-gap", "e4", "d4");
    const baseFacts: FactMap = {
      "answer.EMP-01": "כן, עם כולם",
      "answer.EMP-02": "לא",
      "answer.PRIV-19": ["אין"],
      "answer.FR-04": "לא",
    };
    const result = runCrossChecks(baseFacts, [doc01, doc03, doc04, doc07], "assessment-1");
    expect(result.issues.length).toBeGreaterThan(0);
    for (const issue of result.issues) {
      expect(issue.description).not.toMatch(/הפר|אשם|עבר על החוק|violat|guilty|illegal/i);
    }
  });

  it("is deterministic across repeated calls with identical inputs", async () => {
    const doc01 = await extractAs("DOC-01", "B-overtime-mismatch", "e1", "d1");
    const result1 = runCrossChecks({}, [doc01], "assessment-1");
    const result2 = runCrossChecks({}, [doc01], "assessment-1");
    expect(result1).toEqual(result2);
  });
});
