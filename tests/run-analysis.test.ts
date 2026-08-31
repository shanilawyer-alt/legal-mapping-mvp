import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryRepositories } from "@/lib/db/inMemory";
import { createAssessmentWithToken } from "@/domain/assessment/service";
import { createSessionForToken, submitAnswerForSession } from "@/domain/assessment/session";
import { submitAssessmentForSession } from "@/domain/assessment/submission";
import { uploadDocumentForSession } from "@/domain/documents/service";
import { loadQuestionnaire } from "@/domain/questionnaire/load";
import { evaluateCondition, type AnswerValue } from "@/domain/branching/evaluate";
import { runAnalysis } from "@/domain/analysis/runAnalysis";
import { RULE_CATALOG } from "@/domain/rules/catalog";
import type { Repositories } from "@/lib/db/repositories";
import type { QuestionnaireItem } from "@/domain/questionnaire/types";
import type { DocumentStore } from "@/lib/storage/types";

let repos: Repositories;

beforeEach(() => {
  repos = createInMemoryRepositories();
});

const dummyStore: DocumentStore = {
  async upload() {},
  async delete() {},
  async getSignedDownloadUrl() {
    return "https://example.invalid/signed";
  },
};

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

/** Same forward-pass pattern as tests/submission-lifecycle.test.ts, plus per-question overrides. */
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

async function setupSubmittedAssessment(overrides: Record<string, AnswerValue> = {}) {
  const org = await repos.organizations.create({ legalName: "עסק" });
  const { rawToken } = await createAssessmentWithToken(repos, { organizationId: org.id }, "admin-1");
  const session = await createSessionForToken(repos, rawToken);
  if (!session.ok) throw new Error("setup failed");

  await answerAllCoreQuestions(session.rawSessionToken, overrides);

  await uploadDocumentForSession(repos, dummyStore, {
    rawSessionToken: session.rawSessionToken,
    documentType: "DOC-01",
    originalFilename: "agreement.pdf",
    mimeType: "application/pdf",
    data: Buffer.from("%PDF-1.4\n%test"),
  });

  const submitted = await submitAssessmentForSession(repos, session.rawSessionToken);
  if (!submitted.ok) throw new Error(`setup submit failed: ${JSON.stringify(submitted)}`);

  return { assessment: submitted.assessment, rawSessionToken: session.rawSessionToken };
}

describe("runAnalysis — guards", () => {
  it("returns not_found for an unknown assessment", async () => {
    const result = await runAnalysis(repos, "does-not-exist");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("not_found");
  });

  it("returns not_submitted for a DRAFT assessment", async () => {
    const org = await repos.organizations.create({ legalName: "עסק" });
    const { assessment } = await createAssessmentWithToken(repos, { organizationId: org.id }, "admin-1");
    const result = await runAnalysis(repos, assessment.id);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("not_submitted");
  });

  it("is single-run only — a second call after LAWYER_REVIEW is rejected (OPEN_QUESTIONS item 24)", async () => {
    const { assessment } = await setupSubmittedAssessment();
    const first = await runAnalysis(repos, assessment.id, { fixtureTag: "A-clean" });
    expect(first.ok).toBe(true);

    const second = await runAnalysis(repos, assessment.id, { fixtureTag: "A-clean" });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe("not_submitted");
  });
});

describe("runAnalysis — full pipeline", () => {
  it("transitions SUBMITTED -> LAWYER_REVIEW and persists one rule evaluation per catalog rule", async () => {
    const { assessment } = await setupSubmittedAssessment();
    const result = await runAnalysis(repos, assessment.id, { fixtureTag: "A-clean" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.assessment.status).toBe("LAWYER_REVIEW");
    const stored = await repos.assessments.getById(assessment.id);
    expect(stored?.status).toBe("LAWYER_REVIEW");

    const evaluations = await repos.ruleEvaluations.listByAssessment(assessment.id);
    expect(evaluations).toHaveLength(RULE_CATALOG.length);
    expect(result.ruleEvaluationCount).toBe(RULE_CATALOG.length);
  });

  it("generates a finding for a rule that actually matched the submitted answers", async () => {
    const { assessment } = await setupSubmittedAssessment({ "EMP-01": "לא", "EMP-02": "לא" });
    const result = await runAnalysis(repos, assessment.id, { fixtureTag: "A-clean" });
    expect(result.ok).toBe(true);

    const findings = await repos.findings.listByAssessment(assessment.id);
    expect(findings.some((f) => f.internalTitle === "היעדר מסמך תנאי עבודה")).toBe(true);
  });

  it("always generates a finding for every alwaysRequiresManualReview rule, matched or not", async () => {
    const { assessment } = await setupSubmittedAssessment();
    await runAnalysis(repos, assessment.id, { fixtureTag: "A-clean" });

    const findings = await repos.findings.listByAssessment(assessment.id);
    const manualRuleCount = RULE_CATALOG.filter((r) => r.alwaysRequiresManualReview).length;
    expect(manualRuleCount).toBeGreaterThan(0);
    // Every manual-only rule's finding must be present regardless of a real match.
    for (const rule of RULE_CATALOG.filter((r) => r.alwaysRequiresManualReview)) {
      expect(findings.some((f) => f.internalTitle === rule.topic)).toBe(true);
    }
  });

  it("persists document extractions and derived facts (extraction + cross-check), only for uploaded documents", async () => {
    const { assessment } = await setupSubmittedAssessment();
    await runAnalysis(repos, assessment.id, { fixtureTag: "A-clean" });

    const extractions = await repos.documentExtractions.listByAssessment(assessment.id);
    expect(extractions.length).toBeGreaterThan(0);
    expect(extractions[0].status).toBe("completed");

    const facts = await repos.derivedFacts.listByAssessment(assessment.id);
    expect(facts.some((f) => f.sourceType === "document_extraction")).toBe(true);
    expect(facts.some((f) => f.sourceType === "cross_check")).toBe(true);
  });

  it("skips a document that was soft-deleted before Run Analysis", async () => {
    const org = await repos.organizations.create({ legalName: "עסק" });
    const { rawToken } = await createAssessmentWithToken(repos, { organizationId: org.id }, "admin-1");
    const session = await createSessionForToken(repos, rawToken);
    if (!session.ok) throw new Error("setup failed");
    await answerAllCoreQuestions(session.rawSessionToken);

    const upload = await uploadDocumentForSession(repos, dummyStore, {
      rawSessionToken: session.rawSessionToken,
      documentType: "DOC-01",
      originalFilename: "agreement.pdf",
      mimeType: "application/pdf",
      data: Buffer.from("%PDF-1.4\n%test"),
    });
    if (!upload.ok) throw new Error("upload failed");
    await repos.documents.markDeleted(upload.document.id);

    const submitted = await submitAssessmentForSession(repos, session.rawSessionToken);
    if (!submitted.ok) throw new Error("submit failed");

    const result = await runAnalysis(repos, submitted.assessment.id, { fixtureTag: "A-clean" });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.documentCount).toBe(0);

    const extractions = await repos.documentExtractions.listByAssessment(submitted.assessment.id);
    expect(extractions).toHaveLength(0);
  });

  it("R-TIME-003 and R-PAY-002 match end-to-end via the cross-check engine on the B-overtime-mismatch fixture", async () => {
    const org = await repos.organizations.create({ legalName: "עסק" });
    const { assessment, rawToken } = await createAssessmentWithToken(
      repos,
      { organizationId: org.id },
      "admin-1",
    );
    const session = await createSessionForToken(repos, rawToken);
    if (!session.ok) throw new Error("setup failed");
    await answerAllCoreQuestions(session.rawSessionToken);
    // Pre-existing data finding (unrelated to Phase 3, not fixed here —
    // reported separately): questionnaire.csv's own TIME-07 trigger is
    // "TIME-06 = כן/לעיתים", compiled by the exact-match branching engine
    // (domain/branching/evaluate.ts, Phase 1) into clause values ["כן",
    // "לעיתים"] — but neither is an exact TIME-06 option string (TIME-06's
    // real options are "כן, באופן קבוע" / "כן, לעיתים" / "לא" / "לא יודעת"),
    // so TIME-07 can never actually become visible from any real client
    // answer. Bypassing the client-facing option-validation layer here
    // (repos.answers.upsert directly, not submitAnswerForSession) only to
    // reach the branching engine's own literal trigger value, purely to
    // exercise runAnalysis's downstream cross-check/rule-evaluation
    // integration — not a claim this state is reachable through the UI.
    await repos.answers.upsert(assessment.id, "TIME-06", "כן", "client");
    const time07 = await submitAnswerForSession(repos, session.rawSessionToken, "TIME-07", [
      "רכיב שעות נוספות גלובלי",
    ]);
    if (!time07.ok) throw new Error(`TIME-07 setup failed: ${time07.error}`);
    const time08 = await submitAnswerForSession(repos, session.rawSessionToken, "TIME-08", "לא יודעת");
    if (!time08.ok) throw new Error(`TIME-08 setup failed: ${time08.error}`);

    for (const documentType of ["DOC-01", "DOC-03", "DOC-04"]) {
      const upload = await uploadDocumentForSession(repos, dummyStore, {
        rawSessionToken: session.rawSessionToken,
        documentType,
        originalFilename: `${documentType}.pdf`,
        mimeType: "application/pdf",
        data: Buffer.from("%PDF-1.4\n%test"),
      });
      if (!upload.ok) throw new Error(`upload failed for ${documentType}: ${JSON.stringify(upload)}`);
    }

    const submitted = await submitAssessmentForSession(repos, session.rawSessionToken);
    if (!submitted.ok) throw new Error("submit failed");

    const result = await runAnalysis(repos, submitted.assessment.id, { fixtureTag: "B-overtime-mismatch" });
    expect(result.ok).toBe(true);

    const evaluations = await repos.ruleEvaluations.listByAssessment(submitted.assessment.id);
    const timeEval = evaluations.find((e) => e.ruleId === "R-TIME-003");
    const payEval = evaluations.find((e) => e.ruleId === "R-PAY-002");
    expect(timeEval?.matched).toBe(true);
    expect(payEval?.matched).toBe(true);

    const findings = await repos.findings.listByAssessment(submitted.assessment.id);
    expect(findings.some((f) => f.internalTitle === "רכיב גלובלי שאינו נפרד/לא מגובה")).toBe(true);
  });

  it("records one analysis_run audit event", async () => {
    const { assessment } = await setupSubmittedAssessment();
    await runAnalysis(repos, assessment.id, { fixtureTag: "A-clean" });

    const events = await repos.audit.listByAssessment(assessment.id);
    expect(events.some((e) => e.eventType === "analysis_run")).toBe(true);
  });

  it("does not crash and still evaluates answer-only rules when no fixture tag is given (the real-world default)", async () => {
    const { assessment } = await setupSubmittedAssessment({ "EMP-01": "לא", "EMP-02": "לא" });
    const result = await runAnalysis(repos, assessment.id); // no fixtureTag
    expect(result.ok).toBe(true);

    const extractions = await repos.documentExtractions.listByAssessment(assessment.id);
    expect(extractions.every((e) => e.status === "failed")).toBe(true);

    const findings = await repos.findings.listByAssessment(assessment.id);
    expect(findings.some((f) => f.internalTitle === "היעדר מסמך תנאי עבודה")).toBe(true);
  });
});
