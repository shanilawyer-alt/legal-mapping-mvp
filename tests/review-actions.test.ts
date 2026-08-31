import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryRepositories } from "@/lib/db/inMemory";
import { createAssessmentWithToken } from "@/domain/assessment/service";
import { createSessionForToken, submitAnswerForSession } from "@/domain/assessment/session";
import { submitAssessmentForSession } from "@/domain/assessment/submission";
import { loadQuestionnaire } from "@/domain/questionnaire/load";
import { evaluateCondition, type AnswerValue } from "@/domain/branching/evaluate";
import { runAnalysis } from "@/domain/analysis/runAnalysis";
import { reviewFinding } from "@/domain/review/reviewFinding";
import { approveAssessment } from "@/domain/review/approveAssessment";
import { releaseClientReport } from "@/domain/review/releaseClientReport";
import { generatePreviewForAssessment } from "@/domain/review/generatePreview";
import type { Repositories } from "@/lib/db/repositories";
import type { QuestionnaireItem } from "@/domain/questionnaire/types";
import type { DocumentStore, UploadDocumentInput } from "@/lib/storage/types";

let repos: Repositories;

beforeEach(() => {
  repos = createInMemoryRepositories();
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

function generateValidValue(item: QuestionnaireItem): AnswerValue {
  switch (item.answerType) {
    case "short_text":
      return "טקסט לדוגמה";
    case "number":
    case "hours":
      return 5;
    case "yes_no":
      return "כן";
    case "yes_no_unknown":
      return "כן";
    case "single_choice":
      return item.options?.[0] ?? "";
    case "multi_choice":
      return item.options?.[0] ? [item.options[0]] : [];
  }
}

async function answerAllCoreQuestions(rawSessionToken: string, overrides: Record<string, AnswerValue> = {}) {
  const items = loadQuestionnaire();
  const accum: Record<string, AnswerValue> = {};
  for (const item of items) {
    const active = evaluateCondition(item.triggerCondition, accum);
    if (active && item.isCore) {
      const value = overrides[item.id] ?? generateValidValue(item);
      accum[item.id] = value;
      const result = await submitAnswerForSession(repos, rawSessionToken, item.id, value);
      if (!result.ok) throw new Error(`setup failed answering ${item.id}: ${result.error}`);
    }
  }
}

/** SOC-01="לא" reliably produces a draft CRITICAL finding (R-SOC-001: baseSeverity 5, criticalOverride true). */
async function setupAnalyzedAssessment(overrides: Record<string, AnswerValue> = {}) {
  const org = await repos.organizations.create({ legalName: "עסק" });
  const { rawToken } = await createAssessmentWithToken(repos, { organizationId: org.id }, "admin-1");
  const session = await createSessionForToken(repos, rawToken);
  if (!session.ok) throw new Error("setup failed");
  await answerAllCoreQuestions(session.rawSessionToken, overrides);

  const submitted = await submitAssessmentForSession(repos, session.rawSessionToken);
  if (!submitted.ok) throw new Error("submit failed");

  const result = await runAnalysis(repos, submitted.assessment.id, { fixtureTag: "A-clean" });
  if (!result.ok) throw new Error("runAnalysis failed");

  const findings = await repos.findings.listByAssessment(submitted.assessment.id);
  return { assessment: result.assessment, findings };
}

/**
 * R-INC-001 (alwaysRequiresManualReview, baseSeverity 5, criticalOverride
 * true) always produces a draft CRITICAL finding on every assessment,
 * regardless of answers — so any approveAssessment test must resolve
 * every CRITICAL finding, not just a specific rule's.
 */
async function confirmAllCriticalFindings(assessmentId: string) {
  const findings = await repos.findings.listByAssessment(assessmentId);
  for (const finding of findings) {
    if (finding.riskLevel === "CRITICAL" && finding.status === "draft") {
      await reviewFinding(repos, finding.id, { status: "confirmed" }, "attorney-1");
    }
  }
}

describe("reviewFinding", () => {
  it("returns not_found for an unknown finding", async () => {
    const result = await reviewFinding(repos, "does-not-exist", { status: "confirmed" }, "attorney-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("not_found");
  });

  it("rejects a severity override with no reason", async () => {
    const { findings } = await setupAnalyzedAssessment();
    const result = await reviewFinding(repos, findings[0].id, { severityOverride: 2 }, "attorney-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("override_requires_reason");
  });

  it("accepts a severity override with a reason, storing both plus reviewer/timestamp", async () => {
    const { findings } = await setupAnalyzedAssessment();
    const result = await reviewFinding(
      repos,
      findings[0].id,
      { severityOverride: 2, overrideReason: "נבדק ידנית מול חשבת השכר" },
      "attorney-1",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.finding.severityOverride).toBe(2);
    expect(result.finding.overrideReason).toBe("נבדק ידנית מול חשבת השכר");
    expect(result.finding.reviewedBy).toBe("attorney-1");
    expect(result.finding.reviewedAt).not.toBeNull();
  });

  it("supports confirm / dismiss status changes, a lawyer note, and the visible-to-client toggle", async () => {
    const { findings } = await setupAnalyzedAssessment();
    const [a, b] = findings;

    const confirmed = await reviewFinding(repos, a.id, { status: "confirmed" }, "attorney-1");
    expect(confirmed.ok && confirmed.finding.status).toBe("confirmed");

    const dismissed = await reviewFinding(repos, b.id, { status: "dismissed" }, "attorney-1");
    expect(dismissed.ok && dismissed.finding.status).toBe("dismissed");

    const noted = await reviewFinding(repos, a.id, { lawyerNotes: "לבדוק שוב בעוד חודש" }, "attorney-1");
    expect(noted.ok && noted.finding.lawyerNotes).toBe("לבדוק שוב בעוד חודש");

    const visible = await reviewFinding(repos, a.id, { visibleToClient: true }, "attorney-1");
    expect(visible.ok && visible.finding.visibleToClient).toBe(true);
  });

  it("records one finding_reviewed audit event per call", async () => {
    const { assessment, findings } = await setupAnalyzedAssessment();
    await reviewFinding(repos, findings[0].id, { status: "confirmed" }, "attorney-1");
    const events = await repos.audit.listByAssessment(assessment.id);
    expect(events.filter((e) => e.eventType === "finding_reviewed")).toHaveLength(1);
  });
});

describe("approveAssessment", () => {
  it("returns not_found for an unknown assessment", async () => {
    const result = await approveAssessment(repos, "does-not-exist", "attorney-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("not_found");
  });

  it("returns not_lawyer_review for a DRAFT assessment", async () => {
    const org = await repos.organizations.create({ legalName: "עסק" });
    const { assessment } = await createAssessmentWithToken(repos, { organizationId: org.id }, "admin-1");
    const result = await approveAssessment(repos, assessment.id, "attorney-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("not_lawyer_review");
  });

  it("blocks approval while a CRITICAL finding remains in draft (spec §15, verbatim rule)", async () => {
    const { assessment, findings } = await setupAnalyzedAssessment({ "SOC-01": "לא" });
    const critical = findings.find((f) => f.riskLevel === "CRITICAL");
    expect(critical).toBeDefined();
    expect(critical?.status).toBe("draft");

    const result = await approveAssessment(repos, assessment.id, "attorney-1");
    expect(result.ok).toBe(false);
    if (!result.ok && result.error === "unresolved_critical_findings") {
      expect(result.blockingFindingIds).toContain(critical!.id);
    } else {
      throw new Error("expected unresolved_critical_findings");
    }
  });

  it("succeeds once every CRITICAL finding is confirmed (not draft), setting APPROVED/approvedAt/approvedBy", async () => {
    const { assessment } = await setupAnalyzedAssessment({ "SOC-01": "לא" });
    await confirmAllCriticalFindings(assessment.id);

    const result = await approveAssessment(repos, assessment.id, "attorney-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assessment.status).toBe("APPROVED");
    expect(result.assessment.approvedBy).toBe("attorney-1");
    expect(result.assessment.approvedAt).not.toBeNull();

    const events = await repos.audit.listByAssessment(assessment.id);
    expect(events.some((e) => e.eventType === "assessment_approved")).toBe(true);
  });

  it("a dismissed CRITICAL finding also unblocks approval (dismissed is a resolved disposition, not just confirmed)", async () => {
    const { assessment, findings } = await setupAnalyzedAssessment({ "SOC-01": "לא" });
    for (const f of findings.filter((f) => f.riskLevel === "CRITICAL")) {
      await reviewFinding(repos, f.id, { status: "dismissed" }, "attorney-1");
    }

    const result = await approveAssessment(repos, assessment.id, "attorney-1");
    expect(result.ok).toBe(true);
  });

  it("cannot be approved twice", async () => {
    const { assessment } = await setupAnalyzedAssessment({ "SOC-01": "לא" });
    await confirmAllCriticalFindings(assessment.id);
    await approveAssessment(repos, assessment.id, "attorney-1");

    const second = await approveAssessment(repos, assessment.id, "attorney-1");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe("not_lawyer_review");
  });
});

describe("releaseClientReport", () => {
  it("returns not_found for an unknown assessment", async () => {
    const { store } = createFakeStore();
    const result = await releaseClientReport(repos, store, "does-not-exist", "attorney-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("not_found");
  });

  it("returns not_approved before the assessment is APPROVED", async () => {
    const { store } = createFakeStore();
    const { assessment } = await setupAnalyzedAssessment();
    const result = await releaseClientReport(repos, store, assessment.id, "attorney-1");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("not_approved");
  });

  it("generates a final client report, transitions to CLIENT_REPORT_RELEASED, and audits the release", async () => {
    const { store, uploads } = createFakeStore();
    const { assessment, findings } = await setupAnalyzedAssessment({ "SOC-01": "לא" });
    const critical = findings.find((f) => f.riskLevel === "CRITICAL" && f.internalTitle.includes("פנסיה"))!;
    await reviewFinding(repos, critical.id, { status: "confirmed", visibleToClient: true }, "attorney-1");
    for (const f of findings.filter((f) => f.riskLevel === "CRITICAL" && f.id !== critical.id)) {
      await reviewFinding(repos, f.id, { status: "confirmed" }, "attorney-1");
    }
    const approved = await approveAssessment(repos, assessment.id, "attorney-1");
    if (!approved.ok) throw new Error("approve failed");

    const result = await releaseClientReport(repos, store, assessment.id, "attorney-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.assessment.status).toBe("CLIENT_REPORT_RELEASED");
    expect(result.report.reportType).toBe("client");
    expect(uploads.has(result.report.storagePath)).toBe(true);
    const html = uploads.get(result.report.storagePath)!.data.toString("utf-8");
    expect(html).toContain(critical.clientTitle ?? critical.internalTitle);

    const events = await repos.audit.listByAssessment(assessment.id);
    expect(events.some((e) => e.eventType === "report_released")).toBe(true);

    const stored = await repos.assessments.getById(assessment.id);
    expect(stored?.status).toBe("CLIENT_REPORT_RELEASED");
  });

  it("cannot be released twice", async () => {
    const { store } = createFakeStore();
    const { assessment } = await setupAnalyzedAssessment({ "SOC-01": "לא" });
    await confirmAllCriticalFindings(assessment.id);
    await approveAssessment(repos, assessment.id, "attorney-1");
    await releaseClientReport(repos, store, assessment.id, "attorney-1");

    const second = await releaseClientReport(repos, store, assessment.id, "attorney-1");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe("not_approved");
  });
});

describe("generatePreviewForAssessment", () => {
  it("internal preview includes freelancer screening; client preview never does (OPEN_QUESTIONS item 29)", async () => {
    const { store, uploads } = createFakeStore();
    // FR-04 is conditional (opened by GEN-06 > 0, satisfied by the default
    // core answer), so it must be answered directly, not via the core-only
    // override map — same pattern as tests/run-analysis.test.ts's TIME-07.
    const org = await repos.organizations.create({ legalName: "עסק" });
    const { rawToken } = await createAssessmentWithToken(repos, { organizationId: org.id }, "admin-1");
    const session = await createSessionForToken(repos, rawToken);
    if (!session.ok) throw new Error("setup failed");
    await answerAllCoreQuestions(session.rawSessionToken);
    const fr04 = await submitAnswerForSession(repos, session.rawSessionToken, "FR-04", "לא");
    if (!fr04.ok) throw new Error(`FR-04 setup failed: ${fr04.error}`);

    const submitted = await submitAssessmentForSession(repos, session.rawSessionToken);
    if (!submitted.ok) throw new Error("submit failed");
    const analyzed = await runAnalysis(repos, submitted.assessment.id, { fixtureTag: "A-clean" });
    if (!analyzed.ok) throw new Error("runAnalysis failed");
    const assessment = analyzed.assessment;

    const internal = await generatePreviewForAssessment(repos, store, assessment.id, "internal", "attorney-1");
    const internalHtml = uploads.get(internal.storagePath)!.data.toString("utf-8");
    expect(internalHtml).toContain("סקירת פרילנסרים");

    const client = await generatePreviewForAssessment(repos, store, assessment.id, "client", "attorney-1");
    const clientHtml = uploads.get(client.storagePath)!.data.toString("utf-8");
    expect(clientHtml).not.toContain("סקירת פרילנסרים");
  });
});
