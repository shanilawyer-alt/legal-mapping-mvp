import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryRepositories } from "@/lib/db/inMemory";
import { createAssessmentWithToken } from "@/domain/assessment/service";
import { createSessionForToken, submitAnswerForSession } from "@/domain/assessment/session";
import { uploadDocumentForSession } from "@/domain/documents/service";
import { listAdminAssessmentSummaries } from "@/domain/admin/dashboard";
import type { Repositories } from "@/lib/db/repositories";
import type { DocumentStore } from "@/lib/storage/types";

/**
 * Cross-assessment isolation on the admin side (Phase 2 spec item 11's
 * test list: "document list/view authorization", "cross-assessment
 * admin/client isolation"). The client-session side of this same
 * guarantee is covered by tests/session-isolation.test.ts and the
 * tests/api-*.integration.test.ts files; this file exercises exactly the
 * data assembly the admin assessment detail page
 * (app/(admin)/admin/assessments/[id]/page.tsx) performs: answers,
 * documents, and audit events fetched "by assessment id" must never
 * include another assessment's rows, even though an admin is authorized
 * to view every assessment (OPEN_QUESTIONS.md item 15) — the isolation
 * that matters here is per-assessment data scoping, not per-admin access.
 */

let repos: Repositories;

const noopStore: DocumentStore = {
  async upload() {},
  async getSignedDownloadUrl() {
    return "https://example.test/signed";
  },
  async delete() {},
};

beforeEach(() => {
  repos = createInMemoryRepositories();
});

async function setupFullAssessment(legalName: string, employeeCount: number) {
  const org = await repos.organizations.create({ legalName });
  const { assessment, rawToken } = await createAssessmentWithToken(
    repos,
    { organizationId: org.id },
    "admin-1",
  );
  const session = await createSessionForToken(repos, rawToken);
  if (!session.ok) throw new Error("setup failed");

  await submitAnswerForSession(repos, session.rawSessionToken, "GEN-01", "עוסק מורשה");
  await submitAnswerForSession(repos, session.rawSessionToken, "GEN-04", employeeCount);

  const upload = await uploadDocumentForSession(repos, noopStore, {
    rawSessionToken: session.rawSessionToken,
    documentType: "DOC-01",
    originalFilename: `${legalName}.pdf`,
    mimeType: "application/pdf",
    data: Buffer.from("%PDF-1.4\n%test"),
  });
  if (!upload.ok) throw new Error("upload setup failed");

  return { assessment, document: upload.document };
}

describe("admin assessment detail data — cross-assessment isolation", () => {
  it("answers fetched for assessment A never include assessment B's answers", async () => {
    const a = await setupFullAssessment("עסק א", 5);
    const b = await setupFullAssessment("עסק ב", 12);

    const answersForA = await repos.answers.listByAssessment(a.assessment.id);
    const answersForB = await repos.answers.listByAssessment(b.assessment.id);

    expect(answersForA.every((ans) => ans.assessmentId === a.assessment.id)).toBe(true);
    expect(answersForB.every((ans) => ans.assessmentId === b.assessment.id)).toBe(true);
    // Distinct values confirm these are not accidentally the same rows.
    expect(answersForA.find((ans) => ans.questionId === "GEN-04")?.valueJson).toBe(5);
    expect(answersForB.find((ans) => ans.questionId === "GEN-04")?.valueJson).toBe(12);
  });

  it("documents fetched for assessment A never include assessment B's documents", async () => {
    const a = await setupFullAssessment("עסק א", 5);
    const b = await setupFullAssessment("עסק ב", 12);

    const docsForA = await repos.documents.listByAssessment(a.assessment.id);
    const docsForB = await repos.documents.listByAssessment(b.assessment.id);

    expect(docsForA).toHaveLength(1);
    expect(docsForB).toHaveLength(1);
    expect(docsForA[0].id).not.toBe(docsForB[0].id);
    expect(docsForA[0].originalFilename).toBe("עסק א.pdf");
    expect(docsForB[0].originalFilename).toBe("עסק ב.pdf");
  });

  it("audit events fetched for assessment A never include assessment B's events", async () => {
    const a = await setupFullAssessment("עסק א", 5);
    const b = await setupFullAssessment("עסק ב", 12);

    const eventsForA = await repos.audit.listByAssessment(a.assessment.id);
    const eventsForB = await repos.audit.listByAssessment(b.assessment.id);

    expect(eventsForA.length).toBeGreaterThan(0);
    expect(eventsForB.length).toBeGreaterThan(0);
    expect(eventsForA.every((e) => e.assessmentId === a.assessment.id)).toBe(true);
    expect(eventsForB.every((e) => e.assessmentId === b.assessment.id)).toBe(true);
  });

  it("the dashboard summary for each assessment reports only its own employee count", async () => {
    await setupFullAssessment("עסק א", 5);
    await setupFullAssessment("עסק ב", 12);

    const summaries = await listAdminAssessmentSummaries(repos);
    const summaryA = summaries.find((s) => s.organizationName === "עסק א");
    const summaryB = summaries.find((s) => s.organizationName === "עסק ב");

    expect(summaryA?.employeeCount).toBe(5);
    expect(summaryB?.employeeCount).toBe(12);
  });
});
