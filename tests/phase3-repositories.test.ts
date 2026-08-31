import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryRepositories } from "@/lib/db/inMemory";
import { createAssessmentWithToken } from "@/domain/assessment/service";
import type { Repositories } from "@/lib/db/repositories";

/**
 * Unit tests for the Phase 3 repository ports (documentExtractions,
 * derivedFacts, ruleEvaluations, findings, reports) — the foundation
 * every later Phase 3 domain module (facts, rule engine, cross-check,
 * findings, reports) is built on. Exercises create/list/getById and,
 * critically, cross-assessment isolation for each — the same invariant
 * proven for answers/documents in Phase 1/2.
 */

let repos: Repositories;

beforeEach(() => {
  repos = createInMemoryRepositories();
});

async function setupTwoAssessments() {
  const orgA = await repos.organizations.create({ legalName: "עסק א" });
  const orgB = await repos.organizations.create({ legalName: "עסק ב" });
  const { assessment: a } = await createAssessmentWithToken(repos, { organizationId: orgA.id }, "admin-1");
  const { assessment: b } = await createAssessmentWithToken(repos, { organizationId: orgB.id }, "admin-1");
  return { a, b };
}

describe("documentExtractions repository", () => {
  it("creates and lists an extraction by document", async () => {
    const { a } = await setupTwoAssessments();
    const doc = await repos.documents.create({
      assessmentId: a.id,
      documentType: "DOC-01",
      storagePath: `${a.id}/doc1`,
      originalFilename: "agreement.pdf",
      mimeType: "application/pdf",
      sizeBytes: 100,
      sha256: "abc",
      uploadStatus: "uploaded",
    });

    const extraction = await repos.documentExtractions.create({
      documentId: doc.id,
      schemaName: "employment_agreement",
      schemaVersion: "V1",
      provider: "synthetic",
      model: "fixture-v1",
      extractionJson: { employmentType: "full_time" },
      confidenceJson: {},
      evidenceJson: {},
      status: "completed",
    });

    expect(extraction.documentId).toBe(doc.id);
    const byDoc = await repos.documentExtractions.listByDocument(doc.id);
    expect(byDoc).toHaveLength(1);
    expect(byDoc[0].id).toBe(extraction.id);
  });

  it("listByAssessment never includes another assessment's extractions", async () => {
    const { a, b } = await setupTwoAssessments();
    const docA = await repos.documents.create({
      assessmentId: a.id,
      documentType: "DOC-01",
      storagePath: `${a.id}/doc1`,
      originalFilename: "a.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1,
      sha256: "a",
      uploadStatus: "uploaded",
    });
    const docB = await repos.documents.create({
      assessmentId: b.id,
      documentType: "DOC-01",
      storagePath: `${b.id}/doc1`,
      originalFilename: "b.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1,
      sha256: "b",
      uploadStatus: "uploaded",
    });
    await repos.documentExtractions.create({
      documentId: docA.id,
      schemaName: "s",
      schemaVersion: "V1",
      provider: "synthetic",
      model: "m",
      extractionJson: {},
      confidenceJson: {},
      evidenceJson: {},
      status: "completed",
    });
    await repos.documentExtractions.create({
      documentId: docB.id,
      schemaName: "s",
      schemaVersion: "V1",
      provider: "synthetic",
      model: "m",
      extractionJson: {},
      confidenceJson: {},
      evidenceJson: {},
      status: "completed",
    });

    const forA = await repos.documentExtractions.listByAssessment(a.id);
    const forB = await repos.documentExtractions.listByAssessment(b.id);
    expect(forA).toHaveLength(1);
    expect(forB).toHaveLength(1);
    expect(forA[0].documentId).toBe(docA.id);
    expect(forB[0].documentId).toBe(docB.id);
  });
});

describe("derivedFacts repository", () => {
  it("creates a fact with provenance and lists it back", async () => {
    const { a } = await setupTwoAssessments();
    const fact = await repos.derivedFacts.create({
      assessmentId: a.id,
      factKey: "contract.overtime.type",
      valueJson: "global",
      sourceType: "document_extraction",
      sourceId: "doc-extraction-1",
      confidence: 3,
    });
    expect(fact.factKey).toBe("contract.overtime.type");
    expect(fact.sourceType).toBe("document_extraction");
    expect(fact.confidence).toBe(3);

    const facts = await repos.derivedFacts.listByAssessment(a.id);
    expect(facts).toEqual([fact]);
  });

  it("never leaks facts across assessments", async () => {
    const { a, b } = await setupTwoAssessments();
    await repos.derivedFacts.create({
      assessmentId: a.id,
      factKey: "k",
      valueJson: 1,
      sourceType: "answer",
    });
    const forB = await repos.derivedFacts.listByAssessment(b.id);
    expect(forB).toEqual([]);
  });

  it("defaults sourceId/confidence to null when omitted", async () => {
    const { a } = await setupTwoAssessments();
    const fact = await repos.derivedFacts.create({
      assessmentId: a.id,
      factKey: "k",
      valueJson: true,
      sourceType: "system_derived",
    });
    expect(fact.sourceId).toBeNull();
    expect(fact.confidence).toBeNull();
  });
});

describe("ruleEvaluations repository", () => {
  it("creates and lists a rule evaluation with full input snapshot", async () => {
    const { a } = await setupTwoAssessments();
    const evaluation = await repos.ruleEvaluations.create({
      assessmentId: a.id,
      ruleId: "R-EMP-001",
      ruleVersion: "V1",
      matched: true,
      inputSnapshot: { "EMP-01": "לא", "EMP-02": "לא" },
      baseSeverity: 4,
      scopePoints: 10,
      durationPoints: 4,
      systemicPoints: 5,
      disputePoints: 0,
      overrideCritical: false,
      riskScore: 59,
      riskLevel: "SIGNIFICANT",
      confidence: 1,
    });
    expect(evaluation.ruleId).toBe("R-EMP-001");
    expect(evaluation.inputSnapshot).toEqual({ "EMP-01": "לא", "EMP-02": "לא" });

    const list = await repos.ruleEvaluations.listByAssessment(a.id);
    expect(list).toEqual([evaluation]);
  });

  it("never leaks rule evaluations across assessments", async () => {
    const { a, b } = await setupTwoAssessments();
    await repos.ruleEvaluations.create({
      assessmentId: a.id,
      ruleId: "R-EMP-001",
      ruleVersion: "V1",
      matched: false,
      inputSnapshot: {},
      baseSeverity: 4,
      scopePoints: 0,
      durationPoints: 0,
      systemicPoints: 0,
      disputePoints: 0,
      overrideCritical: false,
      riskScore: 40,
      riskLevel: "MEDIUM",
    });
    expect(await repos.ruleEvaluations.listByAssessment(b.id)).toEqual([]);
  });
});

describe("findings repository", () => {
  it("creates a finding defaulting to draft/not-visible-to-client", async () => {
    const { a } = await setupTwoAssessments();
    const finding = await repos.findings.create({
      assessmentId: a.id,
      category: "דיני עבודה",
      internalTitle: "היעדר מסמך תנאי עבודה",
    });
    expect(finding.status).toBe("draft");
    expect(finding.visibleToClient).toBe(false);
    expect(finding.reviewedBy).toBeNull();
    expect(finding.reviewedAt).toBeNull();
  });

  it("review() confirms a finding and stamps reviewedBy/reviewedAt", async () => {
    const { a } = await setupTwoAssessments();
    const finding = await repos.findings.create({
      assessmentId: a.id,
      category: "דיני עבודה",
      internalTitle: "test",
    });
    const reviewed = await repos.findings.review(finding.id, { status: "confirmed" }, "admin-9");
    expect(reviewed.status).toBe("confirmed");
    expect(reviewed.reviewedBy).toBe("admin-9");
    expect(reviewed.reviewedAt).not.toBeNull();
  });

  it("review() rejects a severity override without a reason", async () => {
    const { a } = await setupTwoAssessments();
    const finding = await repos.findings.create({
      assessmentId: a.id,
      category: "דיני עבודה",
      internalTitle: "test",
    });
    await expect(
      repos.findings.review(finding.id, { severityOverride: 5 }, "admin-9"),
    ).rejects.toThrow(/override_requires_reason/);
  });

  it("review() accepts a severity override with a reason", async () => {
    const { a } = await setupTwoAssessments();
    const finding = await repos.findings.create({
      assessmentId: a.id,
      category: "דיני עבודה",
      internalTitle: "test",
    });
    const reviewed = await repos.findings.review(
      finding.id,
      { severityOverride: 5, overrideReason: "נסיבות מחמירות" },
      "admin-9",
    );
    expect(reviewed.severityOverride).toBe(5);
    expect(reviewed.overrideReason).toBe("נסיבות מחמירות");
  });

  it("getById returns null for an unknown finding", async () => {
    expect(await repos.findings.getById("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("never leaks findings across assessments", async () => {
    const { a, b } = await setupTwoAssessments();
    await repos.findings.create({ assessmentId: a.id, category: "c", internalTitle: "t" });
    expect(await repos.findings.listByAssessment(b.id)).toEqual([]);
  });
});

describe("reports repository", () => {
  it("creates and retrieves a report by id", async () => {
    const { a } = await setupTwoAssessments();
    const report = await repos.reports.create({
      assessmentId: a.id,
      reportType: "internal",
      version: 1,
      storagePath: `${a.id}/reports/internal-v1.html`,
    });
    expect(report.reportType).toBe("internal");
    const fetched = await repos.reports.getById(report.id);
    expect(fetched).toEqual(report);
  });

  it("never leaks reports across assessments", async () => {
    const { a, b } = await setupTwoAssessments();
    await repos.reports.create({
      assessmentId: a.id,
      reportType: "client",
      version: 1,
      storagePath: `${a.id}/reports/client-v1.html`,
    });
    expect(await repos.reports.listByAssessment(b.id)).toEqual([]);
  });
});
