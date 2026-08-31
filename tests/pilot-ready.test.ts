import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryRepositories } from "@/lib/db/inMemory";
import { createAssessmentWithToken } from "@/domain/assessment/service";
import {
  createSessionForToken,
  submitAnswerForSession,
  resolveAssessmentBySessionToken,
} from "@/domain/assessment/session";
import { submitAssessmentForSession } from "@/domain/assessment/submission";
import { uploadDocumentForSession } from "@/domain/documents/service";
import { loadQuestionnaire } from "@/domain/questionnaire/load";
import { evaluateCondition, type AnswerValue } from "@/domain/branching/evaluate";
import { runAnalysis } from "@/domain/analysis/runAnalysis";
import { reviewFinding } from "@/domain/review/reviewFinding";
import { approveAssessment } from "@/domain/review/approveAssessment";
import { releaseClientReport } from "@/domain/review/releaseClientReport";
import { generatePreviewForAssessment } from "@/domain/review/generatePreview";
import { runCrossChecks } from "@/domain/crosscheck";
import { buildFactBundle } from "@/domain/facts/bundle";
import { RULE_CATALOG } from "@/domain/rules/catalog";
import type { Repositories } from "@/lib/db/repositories";
import type { QuestionnaireItem } from "@/domain/questionnaire/types";
import type { DocumentStore, UploadDocumentInput } from "@/lib/storage/types";

/**
 * PILOT_READY acceptance test (Phase 3 instruction, 15 verbatim steps).
 * One synthetic assessment walks the entire deterministic pipeline
 * end to end — every earlier unit/integration test exercises one piece
 * of this in isolation; this test is the thing that actually proves
 * PILOT_READY, per the instruction's own words: "declare PILOT_READY
 * only when a single synthetic assessment can successfully complete
 * this entire flow." A second, fully independent assessment is also
 * carried through part of the same flow to prove step 15 (isolation)
 * against real, not merely theoretical, cross-assessment state.
 */

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
      async getSignedDownloadUrl(storagePath) {
        return `https://example.invalid/signed/${storagePath}`;
      },
    },
  };
}

function generateValidValue(item: QuestionnaireItem): AnswerValue {
  switch (item.answerType) {
    case "short_text":
      return "עסק לדוגמה למיפוי משפטי";
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

describe("PILOT_READY: one synthetic assessment completes the full end-to-end flow", () => {
  it("steps 1-14: create, access, answer, upload, submit, analyze, review, approve, blocked-release, audit", async () => {
    const { store, uploads } = createFakeStore();

    // --- Step 1: admin creates assessment. ---
    const org = await repos.organizations.create({ legalName: "עסק פיילוט בדוי בע\"מ" });
    const { assessment: created, rawToken } = await createAssessmentWithToken(
      repos,
      { organizationId: org.id },
      "admin-1",
    );
    expect(created.status).toBe("DRAFT");

    // --- Step 2: client accesses it through the secure assessment token. ---
    const session = await createSessionForToken(repos, rawToken);
    expect(session.ok).toBe(true);
    if (!session.ok) return;
    const resolved = await resolveAssessmentBySessionToken(repos, session.rawSessionToken);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.assessment.id).toBe(created.id);

    // --- Step 3: client completes the Hebrew RTL questionnaire. ---
    // Every question's client-facing text and options are Hebrew by
    // construction (questionnaire.csv); GEN-02's own free-text answer is
    // Hebrew, exercising RTL content end to end, not just LTR IDs/enums.
    await answerAllCoreQuestions(session.rawSessionToken, { "EMP-01": "לא", "EMP-02": "לא" });
    const answersBeforeSubmit = await repos.answers.listByAssessment(created.id);
    expect(answersBeforeSubmit.length).toBeGreaterThan(0);
    expect(answersBeforeSubmit.find((a) => a.questionId === "GEN-02")?.valueJson).toBe(
      "עסק לדוגמה למיפוי משפטי",
    );

    // --- Step 4: client uploads permitted synthetic documents. ---
    const upload = await uploadDocumentForSession(repos, store, {
      rawSessionToken: session.rawSessionToken,
      documentType: "DOC-01",
      originalFilename: "הסכם-עבודה.pdf",
      mimeType: "application/pdf",
      data: Buffer.from("%PDF-1.4\n%test"),
    });
    expect(upload.ok).toBe(true);
    if (!upload.ok) return;

    // --- Step 5: assessment is submitted. ---
    const submitted = await submitAssessmentForSession(repos, session.rawSessionToken);
    expect(submitted.ok).toBe(true);
    if (!submitted.ok) return;
    expect(submitted.assessment.status).toBe("SUBMITTED");

    // --- Steps 6-10: documents processed into structured facts;
    // questionnaire + document facts normalized with provenance;
    // cross-checks execute; deterministic rules execute; findings and
    // exposure outputs generated. All inside one atomic Run Analysis
    // call (OPEN_QUESTIONS.md item 22). ---
    const analyzed = await runAnalysis(repos, submitted.assessment.id, { fixtureTag: "A-clean" });
    expect(analyzed.ok).toBe(true);
    if (!analyzed.ok) return;
    expect(analyzed.assessment.status).toBe("LAWYER_REVIEW");

    const extractions = await repos.documentExtractions.listByAssessment(submitted.assessment.id);
    expect(extractions).toHaveLength(1); // step 6
    expect(extractions[0].status).toBe("completed");

    const derivedFacts = await repos.derivedFacts.listByAssessment(submitted.assessment.id);
    expect(derivedFacts.length).toBeGreaterThan(0); // step 7
    expect(derivedFacts.every((f) => f.sourceType !== "answer")).toBe(true); // answer facts are never persisted (domain/facts/fromAnswers.ts)
    expect(derivedFacts.every((f) => f.confidence !== null)).toBe(true); // provenance: every persisted fact carries a confidence

    const ruleEvaluations = await repos.ruleEvaluations.listByAssessment(submitted.assessment.id);
    expect(ruleEvaluations).toHaveLength(RULE_CATALOG.length); // step 9: every rule evaluated
    expect(ruleEvaluations.some((e) => e.ruleId === "R-EMP-001" && e.matched)).toBe(true);

    const findings = await repos.findings.listByAssessment(submitted.assessment.id);
    expect(findings.length).toBeGreaterThan(0); // step 10
    expect(findings.every((f) => f.status === "draft")).toBe(true); // no finding is auto-resolved
    expect(findings.some((f) => f.internalTitle === "היעדר מסמך תנאי עבודה")).toBe(true);

    // --- Step 11: attorney can review all relevant inputs and outputs. ---
    // Answers, documents, extracted facts (with provenance, above),
    // cross-check issues, and findings (with which Rule ID produced
    // each) are all independently queryable — exactly what the admin
    // workspace (task #52) renders.
    const answersAfterSubmit = await repos.answers.listByAssessment(submitted.assessment.id);
    const documents = await repos.documents.listByAssessment(submitted.assessment.id);
    expect(answersAfterSubmit.length).toBeGreaterThan(0);
    expect(documents).toHaveLength(1);

    const items = loadQuestionnaire();
    const baseBundle = buildFactBundle({ answers: answersAfterSubmit, items, storedFacts: [] });
    const crossCheckResult = runCrossChecks(baseBundle.map, extractions, submitted.assessment.id);
    expect(Array.isArray(crossCheckResult.issues)).toBe(true); // step 8, re-derivable for review (never re-persisted, see runAnalysis.ts)

    const ruleEvaluationById = new Map(ruleEvaluations.map((e) => [e.id, e]));
    const empFinding = findings.find((f) => f.internalTitle === "היעדר מסמך תנאי עבודה")!;
    const producingEvaluation = ruleEvaluationById.get(empFinding.ruleEvaluationId!);
    expect(producingEvaluation?.ruleId).toBe("R-EMP-001"); // "which Rule ID produced each finding"

    // Attorney resolves every draft CRITICAL finding (spec §15) before approval.
    for (const finding of findings.filter((f) => f.riskLevel === "CRITICAL" && f.status === "draft")) {
      const reviewed = await reviewFinding(
        repos,
        finding.id,
        { status: "confirmed", visibleToClient: true },
        "attorney-1",
      );
      expect(reviewed.ok).toBe(true);
    }
    // Also confirm the ordinary matched finding and mark it client-visible.
    const confirmedEmpFinding = await reviewFinding(
      repos,
      empFinding.id,
      { status: "confirmed", visibleToClient: true },
      "attorney-1",
    );
    expect(confirmedEmpFinding.ok).toBe(true);

    // --- Step 12: report preview is generated. ---
    const internalPreview = await generatePreviewForAssessment(
      repos,
      store,
      submitted.assessment.id,
      "internal",
      "attorney-1",
    );
    expect(internalPreview.reportType).toBe("internal");
    const clientPreview = await generatePreviewForAssessment(
      repos,
      store,
      submitted.assessment.id,
      "client",
      "attorney-1",
    );
    expect(clientPreview.reportType).toBe("client");
    expect(uploads.has(clientPreview.storagePath)).toBe(true);

    // --- Step 13: report remains unreleased until explicit attorney
    // approval. --- A preview existing is not a release: the assessment
    // is still LAWYER_REVIEW, not CLIENT_REPORT_RELEASED, and releasing
    // is rejected before APPROVED.
    const stillLawyerReview = await repos.assessments.getById(submitted.assessment.id);
    expect(stillLawyerReview?.status).toBe("LAWYER_REVIEW");
    const prematureRelease = await releaseClientReport(repos, store, submitted.assessment.id, "attorney-1");
    expect(prematureRelease.ok).toBe(false);

    const approved = await approveAssessment(repos, submitted.assessment.id, "attorney-1");
    expect(approved.ok).toBe(true);
    if (!approved.ok) return;
    expect(approved.assessment.status).toBe("APPROVED");

    // This assessment's analysis used the synthetic fixture provider (a
    // real DOC-01 was uploaded and extracted via fixtureTag: "A-clean")
    // — the pilot-mode safeguard must block release regardless of
    // approval (PILOT_VALIDATION_PLAN.md's safeguards review: "release
    // prevented when synthetic facts materially contribute"). A fully
    // successful release with no synthetic data involved is covered
    // separately by tests/review-actions.test.ts.
    const released = await releaseClientReport(repos, store, submitted.assessment.id, "attorney-1");
    expect(released.ok).toBe(false);
    if (released.ok) return;
    expect(released.error).toBe("synthetic_data_used");

    const stillApproved = await repos.assessments.getById(submitted.assessment.id);
    expect(stillApproved?.status).toBe("APPROVED"); // never reaches CLIENT_REPORT_RELEASED

    const clientPreviewHtml = uploads.get(clientPreview.storagePath)!.data.toString("utf-8");
    expect(clientPreviewHtml).toContain("דוח פיילוט"); // synthetic-data banner (safeguard: "synthetic report clearly marked")
    expect(clientPreviewHtml).toContain("היעדר מסמך תנאי עבודה"); // the confirmed, visible finding still appears in the preview
    expect(clientPreviewHtml).not.toMatch(/R-EMP-\d{3}/); // Rule IDs never appear in the client report (spec §16)

    // --- Step 14: audit trail shows the relevant lifecycle. ---
    const auditEvents = await repos.audit.listByAssessment(submitted.assessment.id);
    const eventTypes = new Set(auditEvents.map((e) => e.eventType));
    for (const expected of [
      "answer_submitted",
      "document_uploaded",
      "assessment_submitted",
      "analysis_run",
      "finding_reviewed",
      "report_generated",
      "assessment_approved",
    ]) {
      expect(eventTypes.has(expected)).toBe(true);
    }
  });

  it("step 15: no assessment data leaks across tokens/users — a second, independent assessment stays fully isolated", async () => {
    const { store } = createFakeStore();

    // Assessment A: carried through analysis and review, as above.
    const orgA = await repos.organizations.create({ legalName: "עסק א׳" });
    const { assessment: assessmentA, rawToken: tokenA } = await createAssessmentWithToken(
      repos,
      { organizationId: orgA.id },
      "admin-1",
    );
    const sessionA = await createSessionForToken(repos, tokenA);
    if (!sessionA.ok) throw new Error("setup failed");
    await answerAllCoreQuestions(sessionA.rawSessionToken, { "EMP-01": "לא", "EMP-02": "לא" });
    await uploadDocumentForSession(repos, store, {
      rawSessionToken: sessionA.rawSessionToken,
      documentType: "DOC-01",
      originalFilename: "a.pdf",
      mimeType: "application/pdf",
      data: Buffer.from("%PDF-1.4\n%test"),
    });
    const submittedA = await submitAssessmentForSession(repos, sessionA.rawSessionToken);
    if (!submittedA.ok) throw new Error("submit A failed");
    await runAnalysis(repos, submittedA.assessment.id, { fixtureTag: "A-clean" });

    // Assessment B: a completely separate organization/client, submitted
    // with deliberately different answers and no documents at all.
    const orgB = await repos.organizations.create({ legalName: "עסק ב׳" });
    const { assessment: assessmentB, rawToken: tokenB } = await createAssessmentWithToken(
      repos,
      { organizationId: orgB.id },
      "admin-1",
    );
    const sessionB = await createSessionForToken(repos, tokenB);
    if (!sessionB.ok) throw new Error("setup failed");
    await answerAllCoreQuestions(sessionB.rawSessionToken, { "EMP-01": "כן, עם כולם", "EMP-02": "כן, לכולם" });
    const submittedB = await submitAssessmentForSession(repos, sessionB.rawSessionToken);
    if (!submittedB.ok) throw new Error("submit B failed");
    await runAnalysis(repos, submittedB.assessment.id, { fixtureTag: "A-clean" });

    expect(assessmentA.id).not.toBe(assessmentB.id);

    // B's session token cannot resolve A's assessment, and vice versa.
    const resolvedAViaB = await resolveAssessmentBySessionToken(repos, sessionB.rawSessionToken);
    expect(resolvedAViaB.ok && resolvedAViaB.assessment.id).not.toBe(assessmentA.id);

    // Every Phase 3 table is scoped correctly — nothing from A appears under B's id, and nothing from B under A's.
    const [answersA, docsA, factsA, findingsA, evalsA] = await Promise.all([
      repos.answers.listByAssessment(assessmentA.id),
      repos.documents.listByAssessment(assessmentA.id),
      repos.derivedFacts.listByAssessment(assessmentA.id),
      repos.findings.listByAssessment(assessmentA.id),
      repos.ruleEvaluations.listByAssessment(assessmentA.id),
    ]);
    const [answersB, docsB, factsB, findingsB, evalsB] = await Promise.all([
      repos.answers.listByAssessment(assessmentB.id),
      repos.documents.listByAssessment(assessmentB.id),
      repos.derivedFacts.listByAssessment(assessmentB.id),
      repos.findings.listByAssessment(assessmentB.id),
      repos.ruleEvaluations.listByAssessment(assessmentB.id),
    ]);

    expect(docsA).toHaveLength(1);
    expect(docsB).toHaveLength(0); // B never uploaded anything — must not see A's document
    expect(answersA.every((a) => !answersB.some((b) => b.id === a.id))).toBe(true);
    expect(factsA.every((f) => f.assessmentId === assessmentA.id)).toBe(true);
    expect(factsB.every((f) => f.assessmentId === assessmentB.id)).toBe(true);
    expect(findingsA.every((f) => f.assessmentId === assessmentA.id)).toBe(true);
    expect(findingsB.every((f) => f.assessmentId === assessmentB.id)).toBe(true);
    expect(evalsA.every((e) => e.assessmentId === assessmentA.id)).toBe(true);
    expect(evalsB.every((e) => e.assessmentId === assessmentB.id)).toBe(true);

    // A's EMP-01/EMP-02 answers ("לא"/"לא") triggered R-EMP-001; B's
    // ("כן, עם כולם"/"כן, לכולם") did not — confirming the two
    // assessments' rule evaluations genuinely diverge, not just that
    // the row counts happen to differ.
    expect(evalsA.find((e) => e.ruleId === "R-EMP-001")?.matched).toBe(true);
    expect(evalsB.find((e) => e.ruleId === "R-EMP-001")?.matched).toBe(false);

    // Audit trails are equally scoped.
    const auditA = await repos.audit.listByAssessment(assessmentA.id);
    const auditB = await repos.audit.listByAssessment(assessmentB.id);
    expect(auditA.every((e) => e.assessmentId === assessmentA.id)).toBe(true);
    expect(auditB.every((e) => e.assessmentId === assessmentB.id)).toBe(true);
  });
});
