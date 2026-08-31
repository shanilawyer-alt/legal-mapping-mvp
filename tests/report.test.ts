import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/domain/csv/parse";
import { reportStructureRowSchema } from "@/domain/csv/schemas";
import { deriveRiskLevelLabelsFromCsv, RISK_LEVEL_LABEL_HE, RISK_LEVEL_ORDER } from "@/domain/report/riskLevelLabels";
import { buildReportData } from "@/domain/report/build";
import { renderReportHtml } from "@/domain/report/render";
import { generateReportPreview } from "@/domain/report/generate";
import { createInMemoryRepositories } from "@/lib/db/inMemory";
import type { DocumentStore, UploadDocumentInput } from "@/lib/storage/types";
import type { Finding, RuleEvaluation } from "@/lib/db/types";
import type { FreelancerScreeningResult } from "@/domain/rules/freelancerScreening";

describe("RISK_LEVEL_LABEL_HE matches report_structure.csv's own cell content exactly", () => {
  it("derives the same 5 Hebrew labels, in LOW..CRITICAL order, from the real CSV", () => {
    const csvText = readFileSync(join(__dirname, "..", "data", "report_structure.csv"), "utf-8");
    const { rows, errors } = parseCsv(csvText, reportStructureRowSchema);
    expect(errors).toEqual([]);
    const derived = deriveRiskLevelLabelsFromCsv(rows);
    expect(derived).not.toBeNull();
    expect(derived).toEqual(RISK_LEVEL_ORDER.map((level) => RISK_LEVEL_LABEL_HE[level]));
  });
});

function makeFinding(overrides: Partial<Finding>): Finding {
  return {
    id: "finding-1",
    assessmentId: "assessment-1",
    ruleEvaluationId: null,
    category: "דיני עבודה",
    subCategory: null,
    internalTitle: "היעדר מסמך תנאי עבודה",
    clientTitle: "היעדר מסמך תנאי עבודה",
    draftInternalText: "יש לבדוק חריגים ומועד מסירה לפי נסיבות.",
    draftClientText: null,
    recommendedAction: "להסדיר מסמכי תנאי עבודה ולבדוק רטרואקטיבית את האוכלוסייה.",
    riskScore: 40,
    riskLevel: "MEDIUM",
    confidence: 1,
    status: "draft",
    visibleToClient: false,
    lawyerNotes: null,
    severityOverride: null,
    overrideReason: null,
    reviewedBy: null,
    reviewedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeEvaluation(overrides: Partial<RuleEvaluation>): RuleEvaluation {
  return {
    id: "eval-1",
    assessmentId: "assessment-1",
    ruleId: "R-EMP-001",
    ruleVersion: "V1",
    matched: true,
    inputSnapshot: { "answer.EMP-01": "לא" },
    baseSeverity: 4,
    scopePoints: 0,
    durationPoints: 0,
    systemicPoints: 0,
    disputePoints: 0,
    overrideCritical: false,
    riskScore: 40,
    riskLevel: "MEDIUM",
    confidence: 1,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("buildReportData", () => {
  it("internal report includes every finding, with full detail (rule ID, score, evidence)", () => {
    const evaluation = makeEvaluation({});
    const finding = makeFinding({ ruleEvaluationId: evaluation.id });
    const data = buildReportData(
      "assessment-1",
      "internal",
      [finding],
      new Map([[evaluation.id, evaluation]]),
      null,
      false,
    );
    expect(data.findings).toHaveLength(1);
    expect(data.findings[0].ruleId).toBe("R-EMP-001");
    expect(data.findings[0].riskScore).toBe(40);
    expect(data.findings[0].riskLevelLabel).toBeNull(); // internal shows the raw level, not the client label
    expect(data.findings[0].inputSnapshot).toEqual({ "answer.EMP-01": "לא" });
  });

  it("client report excludes findings not marked visibleToClient", () => {
    const finding = makeFinding({ visibleToClient: false });
    const data = buildReportData("assessment-1", "client", [finding], new Map(), null, false);
    expect(data.findings).toHaveLength(0);
    expect(data.summary.totalFindings).toBe(0);
  });

  it("client report includes only visibleToClient findings, with score/confidence/evidence hidden", () => {
    const visible = makeFinding({ id: "f-visible", visibleToClient: true, riskLevel: "HIGH" });
    const hidden = makeFinding({ id: "f-hidden", visibleToClient: false });
    const data = buildReportData("assessment-1", "client", [visible, hidden], new Map(), null, false);
    expect(data.findings).toHaveLength(1);
    expect(data.findings[0].findingId).toBe("f-visible");
    expect(data.findings[0].riskScore).toBeNull();
    expect(data.findings[0].confidence).toBeNull();
    expect(data.findings[0].inputSnapshot).toBeNull();
    expect(data.findings[0].legalSourceUrl).toBeNull();
    expect(data.findings[0].possibleService).toBeNull();
    expect(data.findings[0].cautionNote).toBeNull();
    expect(data.findings[0].riskLevelLabel).toBe("גבוה");
  });

  it("client confidence caveat shows only when confidence is 1 (self-report only)", () => {
    const lowConfidence = makeFinding({ visibleToClient: true, confidence: 1 });
    const highConfidence = makeFinding({ id: "f2", visibleToClient: true, confidence: 4 });
    const data = buildReportData("assessment-1", "client", [lowConfidence, highConfidence], new Map(), null, false);
    const [f1, f2] = data.findings;
    expect(f1.confidenceCaveat).toBe("נדרש אימות");
    expect(f2.confidenceCaveat).toBeNull();
  });

  it("summary tallies findings by risk level — a factual count, never generated prose (OPEN_QUESTIONS item 29)", () => {
    const findings = [
      makeFinding({ id: "f1", riskLevel: "LOW" }),
      makeFinding({ id: "f2", riskLevel: "LOW" }),
      makeFinding({ id: "f3", riskLevel: "CRITICAL" }),
    ];
    const data = buildReportData("assessment-1", "internal", findings, new Map(), null, false);
    expect(data.summary.totalFindings).toBe(3);
    expect(data.summary.countByRiskLevel.LOW).toBe(2);
    expect(data.summary.countByRiskLevel.CRITICAL).toBe(1);
    expect(data.summary.countByRiskLevel.MEDIUM).toBe(0);
  });

  it("freelancer screening section appears only in the internal report, never the client report", () => {
    const screening: FreelancerScreeningResult = {
      totalPoints: 30,
      indicators: [],
      disclosure: "The screening score reflects accumulated factual indicators and does not determine the legal status of the service provider.",
    };
    const internal = buildReportData("assessment-1", "internal", [], new Map(), screening, false);
    const client = buildReportData("assessment-1", "client", [], new Map(), screening, false);
    expect(internal.freelancerScreening).toEqual(screening);
    expect(client.freelancerScreening).toBeNull();
  });

  it("possibleService/legalSourceUrl are looked up from the real rule catalog via the evaluation's ruleId", () => {
    const finding = makeFinding({ ruleEvaluationId: "eval-1" });
    const evaluation = makeEvaluation({ id: "eval-1", ruleId: "R-EMP-001" });
    const data = buildReportData(
      "assessment-1",
      "internal",
      [finding],
      new Map([["eval-1", evaluation]]),
      null,
      false,
    );
    expect(data.findings[0].possibleService).toBe("הסכמי עבודה/הודעות לעובד");
  });
});

describe("renderReportHtml", () => {
  it("produces a well-formed RTL Hebrew HTML document", () => {
    const data = buildReportData("assessment-1", "internal", [makeFinding({})], new Map(), null, false);
    const html = renderReportHtml(data);
    expect(html).toContain('<html lang="he" dir="rtl">');
    expect(html).toContain("היעדר מסמך תנאי עבודה");
  });

  it("HTML-escapes finding content to prevent injection", () => {
    const finding = makeFinding({ internalTitle: '<script>alert(1)</script>' });
    const data = buildReportData("assessment-1", "internal", [finding], new Map(), null, false);
    const html = renderReportHtml(data);
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("shows 'no findings' message for an empty client report", () => {
    const data = buildReportData("assessment-1", "client", [], new Map(), null, false);
    const html = renderReportHtml(data);
    expect(html).toContain("אין ממצאים להצגה");
  });

  it("shows a prominent synthetic-data banner when usedSyntheticData is true, on both report types", () => {
    const internal = buildReportData("assessment-1", "internal", [], new Map(), null, true);
    const client = buildReportData("assessment-1", "client", [], new Map(), null, true);
    expect(renderReportHtml(internal)).toContain("דוח פיילוט");
    expect(renderReportHtml(client)).toContain("דוח פיילוט");
  });

  it("shows no synthetic-data banner when usedSyntheticData is false", () => {
    const data = buildReportData("assessment-1", "internal", [], new Map(), null, false);
    expect(renderReportHtml(data)).not.toContain("דוח פיילוט");
  });
});

function createFakeStore(): { store: DocumentStore; uploads: Map<string, UploadDocumentInput> } {
  const uploads = new Map<string, UploadDocumentInput>();
  return {
    uploads,
    store: {
      async upload(input) {
        uploads.set(input.storagePath, input);
      },
      async delete(storagePath) {
        uploads.delete(storagePath);
      },
      async getSignedDownloadUrl() {
        return "https://example.invalid/signed";
      },
    },
  };
}

describe("generateReportPreview", () => {
  it("writes the rendered HTML to private storage and persists a report row, versioned per type", async () => {
    const repos = createInMemoryRepositories();
    const { store, uploads } = createFakeStore();

    const evaluation = await repos.ruleEvaluations.create({
      assessmentId: "assessment-1",
      ruleId: "R-EMP-001",
      ruleVersion: "V1",
      matched: true,
      inputSnapshot: { "answer.EMP-01": "לא" },
      baseSeverity: 4,
      scopePoints: 0,
      durationPoints: 0,
      systemicPoints: 0,
      disputePoints: 0,
      overrideCritical: false,
      riskScore: 40,
      riskLevel: "MEDIUM",
      confidence: 1,
    });
    await repos.findings.create({
      assessmentId: "assessment-1",
      ruleEvaluationId: evaluation.id,
      category: "דיני עבודה",
      internalTitle: "היעדר מסמך תנאי עבודה",
      clientTitle: "היעדר מסמך תנאי עבודה",
      recommendedAction: "להסדיר מסמכי תנאי עבודה.",
      riskScore: 40,
      riskLevel: "MEDIUM",
      confidence: 1,
    });

    const report1 = await generateReportPreview(repos, store, "assessment-1", "internal", null, "attorney-1");
    expect(report1.version).toBe(1);
    expect(report1.storagePath).toBe("assessment-1/reports/internal-v1.html");
    expect(uploads.has(report1.storagePath)).toBe(true);
    expect(uploads.get(report1.storagePath)?.mimeType).toBe("text/html");
    const html = uploads.get(report1.storagePath)!.data.toString("utf-8");
    expect(html).toContain("היעדר מסמך תנאי עבודה");

    const report2 = await generateReportPreview(repos, store, "assessment-1", "internal", null, "attorney-1");
    expect(report2.version).toBe(2); // re-generating bumps the version, doesn't overwrite

    const clientReport = await generateReportPreview(repos, store, "assessment-1", "client", null, "attorney-1");
    expect(clientReport.version).toBe(1); // versioned independently per report type

    const persisted = await repos.reports.listByAssessment("assessment-1");
    expect(persisted).toHaveLength(3);

    const events = await repos.audit.listByAssessment("assessment-1");
    const reportEvents = events.filter((e) => e.eventType === "report_generated");
    expect(reportEvents).toHaveLength(3); // one per generateReportPreview call above
    expect(reportEvents[0].metadataJson).toMatchObject({ reportType: "internal", version: 1 });
  });

  it("a client report generated before any attorney review shows zero findings (item 29's intentional gate)", async () => {
    const repos = createInMemoryRepositories();
    const { store, uploads } = createFakeStore();
    const evaluation = await repos.ruleEvaluations.create({
      assessmentId: "assessment-2",
      ruleId: "R-EMP-001",
      ruleVersion: "V1",
      matched: true,
      inputSnapshot: {},
      baseSeverity: 4,
      scopePoints: 0,
      durationPoints: 0,
      systemicPoints: 0,
      disputePoints: 0,
      overrideCritical: false,
      riskScore: 40,
      riskLevel: "MEDIUM",
      confidence: 1,
    });
    await repos.findings.create({
      assessmentId: "assessment-2",
      ruleEvaluationId: evaluation.id,
      category: "דיני עבודה",
      internalTitle: "x",
      recommendedAction: "y",
    });

    const report = await generateReportPreview(repos, store, "assessment-2", "client", null, "attorney-1");
    const html = uploads.get(report.storagePath)!.data.toString("utf-8");
    expect(html).toContain("אין ממצאים להצגה");
  });
});
