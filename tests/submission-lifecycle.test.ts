import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryRepositories } from "@/lib/db/inMemory";
import { createAssessmentWithToken } from "@/domain/assessment/service";
import {
  createSessionForToken,
  submitAnswerForSession,
  resolveAssessmentBySessionToken,
} from "@/domain/assessment/session";
import { submitAssessmentForSession, reopenAssessment } from "@/domain/assessment/submission";
import { uploadDocumentForSession } from "@/domain/documents/service";
import { loadQuestionnaire } from "@/domain/questionnaire/load";
import { evaluateCondition, type AnswerValue } from "@/domain/branching/evaluate";
import type { Repositories } from "@/lib/db/repositories";
import type { QuestionnaireItem } from "@/domain/questionnaire/types";
import type { DocumentStore } from "@/lib/storage/types";

let repos: Repositories;

beforeEach(() => {
  repos = createInMemoryRepositories();
});

async function setupSession(legalName: string) {
  const org = await repos.organizations.create({ legalName });
  const { assessment, rawToken } = await createAssessmentWithToken(
    repos,
    { organizationId: org.id },
    "admin-1",
  );
  const session = await createSessionForToken(repos, rawToken);
  if (!session.ok) throw new Error("setup failed");
  return { assessment, rawSessionToken: session.rawSessionToken };
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

/** Answers every currently-required (core, active) question, in questionnaire
 * order, revealing later conditional core questions as it goes — the same
 * forward-pass invariant domain/questionnaire/effective.ts relies on. */
async function answerAllCoreQuestions(rawSessionToken: string) {
  const items = loadQuestionnaire();
  const accum: Record<string, AnswerValue> = {};
  for (const item of items) {
    const active = evaluateCondition(item.triggerCondition, accum);
    if (active && item.isCore) {
      const value = generateValidValue(item);
      accum[item.id] = value;
      const result = await submitAnswerForSession(repos, rawSessionToken, item.id, value);
      if (!result.ok) throw new Error(`setup failed answering ${item.id}: ${result.error}`);
    }
  }
}

const dummyStore: DocumentStore = {
  async upload() {},
  async delete() {},
  async getSignedDownloadUrl() {
    return "https://example.invalid/signed";
  },
};

describe("submitAssessmentForSession", () => {
  it("rejects submission when required core questions are unanswered", async () => {
    const { rawSessionToken } = await setupSession("עסק לא מלא");
    const result = await submitAssessmentForSession(repos, rawSessionToken);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toBe("missing_required");
    if (result.error !== "missing_required") return;
    expect(result.missingQuestionIds.length).toBeGreaterThan(0);
    // GEN-01 is core and always visible — must appear in the very first check.
    expect(result.missingQuestionIds).toContain("GEN-01");
  });

  it("does not require a conditional (non-core) question, even if visible", async () => {
    const { rawSessionToken } = await setupSession("עסק");
    await answerAllCoreQuestions(rawSessionToken);
    const result = await submitAssessmentForSession(repos, rawSessionToken);
    expect(result.ok).toBe(true);
  });

  it("succeeds once every currently-required core question is answered, and sets SUBMITTED + submittedAt", async () => {
    const { rawSessionToken, assessment } = await setupSession("עסק מלא");
    await answerAllCoreQuestions(rawSessionToken);

    const result = await submitAssessmentForSession(repos, rawSessionToken);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assessment.status).toBe("SUBMITTED");
    expect(result.assessment.submittedAt).not.toBeNull();

    const stored = await repos.assessments.getById(assessment.id);
    expect(stored?.status).toBe("SUBMITTED");
  });

  it("does not count a stale (now-hidden) core answer toward satisfying a requirement", async () => {
    const { rawSessionToken } = await setupSession("עסק");
    await answerAllCoreQuestions(rawSessionToken);
    // GEN-04 gates most of the core conditional section. Flip it back to 0
    // — everything gated on "GEN-04 > 0" becomes hidden again, and their
    // still-stored answers become stale (item 18), not effective.
    await submitAnswerForSession(repos, rawSessionToken, "GEN-04", 0);

    const result = await submitAssessmentForSession(repos, rawSessionToken);
    // GEN-04 itself is core, always visible, and has an answer (0), so this
    // must succeed — nothing gated on it is required anymore either.
    expect(result.ok).toBe(true);
  });

  it("rejects submitting an already-submitted assessment as locked", async () => {
    const { rawSessionToken } = await setupSession("עסק");
    await answerAllCoreQuestions(rawSessionToken);
    const first = await submitAssessmentForSession(repos, rawSessionToken);
    expect(first.ok).toBe(true);

    const second = await submitAssessmentForSession(repos, rawSessionToken);
    expect(second).toEqual({ ok: false, error: "locked" });
  });

  it("records an audit event on submission", async () => {
    const { rawSessionToken, assessment } = await setupSession("עסק");
    await answerAllCoreQuestions(rawSessionToken);
    await submitAssessmentForSession(repos, rawSessionToken);

    const events = await repos.audit.listByAssessment(assessment.id);
    expect(events.some((e) => e.eventType === "assessment_submitted")).toBe(true);
  });
});

describe("locking after submission", () => {
  it("rejects a further answer write once SUBMITTED", async () => {
    const { rawSessionToken } = await setupSession("עסק");
    await answerAllCoreQuestions(rawSessionToken);
    await submitAssessmentForSession(repos, rawSessionToken);

    const result = await submitAnswerForSession(repos, rawSessionToken, "GEN-02", "ניסיון לערוך");
    expect(result).toEqual({ ok: false, error: "locked" });
  });

  it("rejects a further document upload once SUBMITTED", async () => {
    const { rawSessionToken } = await setupSession("עסק");
    await answerAllCoreQuestions(rawSessionToken);
    await submitAssessmentForSession(repos, rawSessionToken);

    const result = await uploadDocumentForSession(repos, dummyStore, {
      rawSessionToken,
      documentType: "DOC-01",
      originalFilename: "test.pdf",
      mimeType: "application/pdf",
      data: Buffer.from("%PDF-1.4\n%test"),
    });
    expect(result).toEqual({ ok: false, error: "locked" });
  });

  it("still allows reading answers once SUBMITTED", async () => {
    const { rawSessionToken } = await setupSession("עסק");
    await answerAllCoreQuestions(rawSessionToken);
    await submitAssessmentForSession(repos, rawSessionToken);

    const resolved = await resolveAssessmentBySessionToken(repos, rawSessionToken);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.assessment.status).toBe("SUBMITTED");
  });
});

describe("reopenAssessment", () => {
  it("reopens a SUBMITTED assessment back to DRAFT", async () => {
    const { rawSessionToken, assessment } = await setupSession("עסק");
    await answerAllCoreQuestions(rawSessionToken);
    await submitAssessmentForSession(repos, rawSessionToken);

    const result = await reopenAssessment(repos, assessment.id, "admin-1");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.assessment.status).toBe("DRAFT");
    expect(result.assessment.submittedAt).toBeNull();
  });

  it("allows editing again after reopen", async () => {
    const { rawSessionToken, assessment } = await setupSession("עסק");
    await answerAllCoreQuestions(rawSessionToken);
    await submitAssessmentForSession(repos, rawSessionToken);
    await reopenAssessment(repos, assessment.id, "admin-1");

    const result = await submitAnswerForSession(repos, rawSessionToken, "GEN-02", "עדכון אחרי פתיחה מחדש");
    expect(result.ok).toBe(true);
  });

  it("rejects reopening a DRAFT assessment (nothing to reopen)", async () => {
    const { assessment } = await setupSession("עסק");
    const result = await reopenAssessment(repos, assessment.id, "admin-1");
    expect(result).toEqual({ ok: false, error: "not_reopenable" });
  });

  it("rejects reopening an unknown assessment id", async () => {
    const result = await reopenAssessment(repos, "00000000-0000-0000-0000-000000000000", "admin-1");
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("records an audit event on reopen", async () => {
    const { rawSessionToken, assessment } = await setupSession("עסק");
    await answerAllCoreQuestions(rawSessionToken);
    await submitAssessmentForSession(repos, rawSessionToken);
    await reopenAssessment(repos, assessment.id, "admin-42");

    const events = await repos.audit.listByAssessment(assessment.id);
    const reopenEvent = events.find((e) => e.eventType === "assessment_reopened");
    expect(reopenEvent).toBeDefined();
    expect(reopenEvent?.actorId).toBe("admin-42");
    expect(reopenEvent?.actorType).toBe("admin");
  });
});
