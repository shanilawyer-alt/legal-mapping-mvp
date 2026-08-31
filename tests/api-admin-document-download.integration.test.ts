import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createInMemoryRepositories } from "@/lib/db/inMemory";
import { createAssessmentWithToken } from "@/domain/assessment/service";
import { createSessionForToken } from "@/domain/assessment/session";
import { uploadDocumentForSession } from "@/domain/documents/service";
import type { Repositories } from "@/lib/db/repositories";
import type { DocumentStore } from "@/lib/storage/types";

/**
 * Integration-level tests for the ACTUAL route handler in
 * app/(admin)/admin/documents/[id]/download/route.ts — the only path an
 * admin has to a document's bytes (Phase 2 spec item 6). Mirrors the
 * pattern in tests/api-documents.integration.test.ts.
 */

let repos: Repositories;
let currentAdminUserId: string | null;
let signedUrlRequests: string[];

vi.mock("@/lib/db", () => ({
  getRepositories: () => repos,
}));

vi.mock("@/lib/storage", () => ({
  getDocumentStore: (): DocumentStore => ({
    async upload() {},
    async getSignedDownloadUrl(storagePath) {
      signedUrlRequests.push(storagePath);
      return `https://example.test/signed/${storagePath}`;
    },
    async delete() {},
  }),
}));

vi.mock("@/lib/supabase/server", () => ({
  getAdminUserId: async () => currentAdminUserId,
}));

beforeEach(() => {
  repos = createInMemoryRepositories();
  currentAdminUserId = "admin-1";
  signedUrlRequests = [];
});

async function setupAssessmentWithDocument() {
  const org = await repos.organizations.create({ legalName: "עסק" });
  const { rawToken } = await createAssessmentWithToken(repos, { organizationId: org.id }, "admin-1");
  const session = await createSessionForToken(repos, rawToken);
  if (!session.ok) throw new Error("setup failed");

  const upload = await uploadDocumentForSession(repos, {
    async upload() {},
    async getSignedDownloadUrl() {
      return "unused";
    },
    async delete() {},
  }, {
    rawSessionToken: session.rawSessionToken,
    documentType: "DOC-01",
    originalFilename: "report.pdf",
    mimeType: "application/pdf",
    data: Buffer.from("%PDF-1.4\n%test"),
  });
  if (!upload.ok) throw new Error("upload setup failed");
  return upload.document;
}

function requestFor(documentId: string) {
  return new NextRequest(`http://localhost/admin/documents/${documentId}/download`);
}

describe("GET /admin/documents/[id]/download", () => {
  it("rejects an unauthenticated request", async () => {
    currentAdminUserId = null;
    const document = await setupAssessmentWithDocument();
    const { GET } = await import("@/app/(admin)/admin/documents/[id]/download/route");
    const res = await GET(requestFor(document.id), { params: Promise.resolve({ id: document.id }) });
    expect(res.status).toBe(401);
    expect(signedUrlRequests).toEqual([]);
  });

  it("redirects to a freshly-issued signed URL for a real document", async () => {
    const document = await setupAssessmentWithDocument();
    const { GET } = await import("@/app/(admin)/admin/documents/[id]/download/route");
    const res = await GET(requestFor(document.id), { params: Promise.resolve({ id: document.id }) });
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(`https://example.test/signed/${document.storagePath}`);
    expect(signedUrlRequests).toEqual([document.storagePath]);
  });

  it("never exposes the raw storage path in the response — only the store's signed URL", async () => {
    const document = await setupAssessmentWithDocument();
    const { GET } = await import("@/app/(admin)/admin/documents/[id]/download/route");
    const res = await GET(requestFor(document.id), { params: Promise.resolve({ id: document.id }) });
    const location = res.headers.get("location");
    expect(location).not.toBe(document.storagePath);
  });

  it("returns 404 for an unknown document id", async () => {
    const { GET } = await import("@/app/(admin)/admin/documents/[id]/download/route");
    const res = await GET(requestFor("00000000-0000-0000-0000-000000000000"), {
      params: Promise.resolve({ id: "00000000-0000-0000-0000-000000000000" }),
    });
    expect(res.status).toBe(404);
  });

  it("records a document_accessed audit event with the admin's actor id", async () => {
    const document = await setupAssessmentWithDocument();
    const { GET } = await import("@/app/(admin)/admin/documents/[id]/download/route");
    await GET(requestFor(document.id), { params: Promise.resolve({ id: document.id }) });

    const events = await repos.audit.listByAssessment(document.assessmentId);
    const accessEvent = events.find((e) => e.eventType === "document_accessed");
    expect(accessEvent).toBeDefined();
    expect(accessEvent?.actorId).toBe("admin-1");
  });
});
