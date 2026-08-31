import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryRepositories } from "@/lib/db/inMemory";
import { createAssessmentWithToken } from "@/domain/assessment/service";
import { createSessionForToken } from "@/domain/assessment/session";
import { uploadDocumentForSession } from "@/domain/documents/service";
import {
  deleteDocumentAsAdmin,
  issueSignedDownloadUrlForAdmin,
} from "@/domain/documents/service";
import type { Repositories } from "@/lib/db/repositories";
import type { DocumentStore } from "@/lib/storage/types";

let repos: Repositories;
let deletedPaths: string[];
let signedUrlRequests: string[];

const store: DocumentStore = {
  async upload() {},
  async getSignedDownloadUrl(storagePath) {
    signedUrlRequests.push(storagePath);
    return `https://example.test/signed/${storagePath}`;
  },
  async delete(storagePath) {
    deletedPaths.push(storagePath);
  },
};

beforeEach(() => {
  repos = createInMemoryRepositories();
  deletedPaths = [];
  signedUrlRequests = [];
});

async function setupAssessmentWithDocument() {
  const org = await repos.organizations.create({ legalName: "עסק" });
  const { assessment, rawToken } = await createAssessmentWithToken(
    repos,
    { organizationId: org.id },
    "admin-1",
  );
  const session = await createSessionForToken(repos, rawToken);
  if (!session.ok) throw new Error("setup failed");

  const upload = await uploadDocumentForSession(repos, store, {
    rawSessionToken: session.rawSessionToken,
    documentType: "DOC-01",
    originalFilename: "report.pdf",
    mimeType: "application/pdf",
    data: Buffer.from("%PDF-1.4\n%test"),
  });
  if (!upload.ok) throw new Error("upload setup failed");

  return { assessment, document: upload.document };
}

describe("deleteDocumentAsAdmin", () => {
  it("removes the object from storage and soft-deletes the DB row", async () => {
    const { assessment, document } = await setupAssessmentWithDocument();

    const result = await deleteDocumentAsAdmin(repos, store, assessment.id, document.id, "admin-9");
    expect(result).toEqual({ ok: true });
    expect(deletedPaths).toEqual([document.storagePath]);

    const stored = await repos.documents.getById(document.id);
    expect(stored?.uploadStatus).toBe("deleted");
    expect(stored?.deletedAt).not.toBeNull();
    // Soft delete only — the row itself is kept, not removed.
    expect(stored).not.toBeNull();
  });

  it("records an audit event with the admin's actor id", async () => {
    const { assessment, document } = await setupAssessmentWithDocument();
    await deleteDocumentAsAdmin(repos, store, assessment.id, document.id, "admin-9");

    const events = await repos.audit.listByAssessment(assessment.id);
    const deleteEvent = events.find((e) => e.eventType === "document_deleted");
    expect(deleteEvent).toBeDefined();
    expect(deleteEvent?.actorType).toBe("admin");
    expect(deleteEvent?.actorId).toBe("admin-9");
  });

  it("rejects a document that does not belong to the given assessment", async () => {
    const a = await setupAssessmentWithDocument();
    const b = await setupAssessmentWithDocument();

    const result = await deleteDocumentAsAdmin(repos, store, a.assessment.id, b.document.id, "admin-9");
    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(deletedPaths).toEqual([]);

    const untouched = await repos.documents.getById(b.document.id);
    expect(untouched?.uploadStatus).toBe("uploaded");
  });

  it("rejects an unknown document id", async () => {
    const { assessment } = await setupAssessmentWithDocument();
    const result = await deleteDocumentAsAdmin(
      repos,
      store,
      assessment.id,
      "00000000-0000-0000-0000-000000000000",
      "admin-9",
    );
    expect(result).toEqual({ ok: false, error: "not_found" });
  });
});

describe("issueSignedDownloadUrlForAdmin", () => {
  it("returns a signed URL for the document's storage path", async () => {
    const { document } = await setupAssessmentWithDocument();
    const result = await issueSignedDownloadUrlForAdmin(repos, store, document.id, "admin-9");
    expect(result).toEqual({ ok: true, url: `https://example.test/signed/${document.storagePath}` });
    expect(signedUrlRequests).toEqual([document.storagePath]);
  });

  it("never returns a raw/public storage path — only what the store itself returns", async () => {
    const { document } = await setupAssessmentWithDocument();
    const result = await issueSignedDownloadUrlForAdmin(repos, store, document.id, "admin-9");
    expect(result.ok && result.url).not.toBe(document.storagePath);
  });

  it("records a document_accessed audit event", async () => {
    const { assessment, document } = await setupAssessmentWithDocument();
    await issueSignedDownloadUrlForAdmin(repos, store, document.id, "admin-9");

    const events = await repos.audit.listByAssessment(assessment.id);
    const accessEvent = events.find((e) => e.eventType === "document_accessed");
    expect(accessEvent).toBeDefined();
    expect(accessEvent?.actorId).toBe("admin-9");
  });

  it("rejects an unknown document id", async () => {
    const result = await issueSignedDownloadUrlForAdmin(
      repos,
      store,
      "00000000-0000-0000-0000-000000000000",
      "admin-9",
    );
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("rejects a deleted document — no signed URL is issued for it again", async () => {
    const { assessment, document } = await setupAssessmentWithDocument();
    await deleteDocumentAsAdmin(repos, store, assessment.id, document.id, "admin-9");

    const result = await issueSignedDownloadUrlForAdmin(repos, store, document.id, "admin-9");
    expect(result).toEqual({ ok: false, error: "not_found" });
  });
});
