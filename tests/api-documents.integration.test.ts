import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createInMemoryRepositories } from "@/lib/db/inMemory";
import { createAssessmentWithToken } from "@/domain/assessment/service";
import { createSessionForToken } from "@/domain/assessment/session";
import { ASSESSMENT_SESSION_COOKIE } from "@/lib/security/sessionCookie";
import type { Repositories } from "@/lib/db/repositories";
import type { DocumentStore } from "@/lib/storage/types";

/**
 * Integration-level tests for the ACTUAL route handler in
 * app/api/documents/route.ts. lib/db and lib/storage are mocked to
 * in-memory/no-op implementations (no live Supabase project or Storage
 * bucket is reachable from this environment — see OPEN_QUESTIONS.md), but
 * request parsing (real multipart FormData), cookie reading, validation,
 * and response shapes are all exercised through the real handler.
 */

let repos: Repositories;
let uploadedPaths: string[];

vi.mock("@/lib/db", () => ({
  getRepositories: () => repos,
}));

vi.mock("@/lib/storage", () => ({
  getDocumentStore: (): DocumentStore => ({
    async upload(input) {
      uploadedPaths.push(input.storagePath);
    },
    async getSignedDownloadUrl() {
      return "https://example.test/signed";
    },
    async delete() {},
  }),
}));

beforeEach(() => {
  repos = createInMemoryRepositories();
  uploadedPaths = [];
});

const DOCUMENTS_URL = "http://localhost/api/documents";
const PDF_BYTES = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n");

function requestWithFormData(cookieValue: string | null, formData: FormData) {
  const headers: Record<string, string> = {};
  if (cookieValue !== null) headers["cookie"] = `${ASSESSMENT_SESSION_COOKIE}=${cookieValue}`;
  return new NextRequest(DOCUMENTS_URL, { method: "POST", headers, body: formData });
}

function pdfFormData(filename = "report.pdf") {
  const formData = new FormData();
  formData.set("documentType", "הסכם עבודה מייצג");
  formData.set("file", new File([PDF_BYTES], filename, { type: "application/pdf" }));
  return formData;
}

async function setupAssessmentWithSession(legalName: string) {
  const org = await repos.organizations.create({ legalName });
  const { rawToken } = await createAssessmentWithToken(repos, { organizationId: org.id }, "admin-1");
  const session = await createSessionForToken(repos, rawToken);
  if (!session.ok) throw new Error("setup failed");
  return { rawSessionToken: session.rawSessionToken, assessmentId: session.assessment.id };
}

describe("POST /api/documents", () => {
  it("rejects an upload with no session cookie", async () => {
    const { POST } = await import("@/app/api/documents/route");
    const res = await POST(requestWithFormData(null, pdfFormData()));
    expect(res.status).toBe(404);
    expect(uploadedPaths).toEqual([]);
  });

  it("rejects an upload with a forged session cookie", async () => {
    const { POST } = await import("@/app/api/documents/route");
    const res = await POST(requestWithFormData("forged-session-token", pdfFormData()));
    expect(res.status).toBe(404);
    expect(uploadedPaths).toEqual([]);
  });

  it("rejects an expired session", async () => {
    const org = await repos.organizations.create({ legalName: "עסק שפג" });
    const assessment = await repos.assessments.create({
      organizationId: org.id,
      secureTokenHash: "irrelevant",
      tokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60),
      assessmentVersion: "V1",
      questionnaireVersion: "V1",
      ruleEngineVersion: "V1",
    });
    const { hashSecureToken, generateSecureToken } = await import("@/lib/security/token");
    const rawSessionToken = generateSecureToken();
    await repos.assessmentSessions.create({
      assessmentId: assessment.id,
      sessionTokenHash: hashSecureToken(rawSessionToken),
      expiresAt: new Date(Date.now() - 1000),
    });

    const { POST } = await import("@/app/api/documents/route");
    const res = await POST(requestWithFormData(rawSessionToken, pdfFormData()));
    expect(res.status).toBe(410);
    expect(uploadedPaths).toEqual([]);
  });

  it("rejects a file whose content doesn't match its declared type, end to end", async () => {
    const { rawSessionToken } = await setupAssessmentWithSession("עסק");
    const formData = new FormData();
    formData.set("documentType", "מסמך");
    // Declares PDF but the bytes are a PNG signature.
    const pngBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    formData.set("file", new File([pngBytes], "fake.pdf", { type: "application/pdf" }));

    const { POST } = await import("@/app/api/documents/route");
    const res = await POST(requestWithFormData(rawSessionToken, formData));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("validation");
    expect(uploadedPaths).toEqual([]);
  });

  it("stores a valid upload scoped to the requesting session's own assessment only", async () => {
    const a = await setupAssessmentWithSession("עסק א");
    const b = await setupAssessmentWithSession("עסק ב");

    const { POST } = await import("@/app/api/documents/route");
    const res = await POST(requestWithFormData(a.rawSessionToken, pdfFormData()));
    expect(res.ok).toBe(true);

    const docsForA = await repos.documents.listByAssessment(a.assessmentId);
    const docsForB = await repos.documents.listByAssessment(b.assessmentId);
    expect(docsForA).toHaveLength(1);
    expect(docsForB).toHaveLength(0);
    expect(uploadedPaths).toHaveLength(1);
    expect(uploadedPaths[0].startsWith(`${a.assessmentId}/`)).toBe(true);
  });
});
