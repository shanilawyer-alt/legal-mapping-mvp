import { describe, expect, it } from "vitest";
import { createSyntheticExtractor } from "@/domain/extraction/syntheticProvider";
import {
  EXTRACTION_SCHEMAS_BY_DOCUMENT_TYPE,
  employmentAgreementSchema,
  payslipSchema,
  attendanceSchema,
  freelancerAgreementSchema,
  privacyNoticeSchema,
} from "@/domain/extraction/schemas";
import {
  FIXTURE_A_DOC01,
  FIXTURE_B_DOC01,
  FIXTURE_B_DOC03,
  FIXTURE_B_DOC04,
  FIXTURE_C_DOC07,
  FIXTURE_D_DOC06,
} from "@/domain/extraction/fixtures";

describe("extraction schemas — every synthetic fixture validates against its own schema", () => {
  it("FIXTURE_A_DOC01 / FIXTURE_B_DOC01 match employmentAgreementSchema", () => {
    expect(employmentAgreementSchema.safeParse(FIXTURE_A_DOC01).success).toBe(true);
    expect(employmentAgreementSchema.safeParse(FIXTURE_B_DOC01).success).toBe(true);
  });
  it("FIXTURE_B_DOC03 matches payslipSchema", () => {
    expect(payslipSchema.safeParse(FIXTURE_B_DOC03).success).toBe(true);
  });
  it("FIXTURE_B_DOC04 matches attendanceSchema", () => {
    expect(attendanceSchema.safeParse(FIXTURE_B_DOC04).success).toBe(true);
  });
  it("FIXTURE_C_DOC07 matches privacyNoticeSchema", () => {
    expect(privacyNoticeSchema.safeParse(FIXTURE_C_DOC07).success).toBe(true);
  });
  it("FIXTURE_D_DOC06 matches freelancerAgreementSchema", () => {
    expect(freelancerAgreementSchema.safeParse(FIXTURE_D_DOC06).success).toBe(true);
  });
  it("has a schema registered for every DOC-01..DOC-08 document type", () => {
    for (let n = 1; n <= 8; n++) {
      const id = `DOC-0${n}`;
      expect(EXTRACTION_SCHEMAS_BY_DOCUMENT_TYPE[id]).toBeDefined();
    }
  });
});

describe("createSyntheticExtractor", () => {
  const extractor = createSyntheticExtractor();

  it("returns a completed extraction for a matched fixture, split into extractionJson + evidenceJson", async () => {
    const result = await extractor.extract({
      documentId: "doc-1",
      documentType: "DOC-01",
      storagePath: "assessment-1/doc-1",
      sha256: "irrelevant-in-synthetic-mode",
      fixtureTag: "B-overtime-mismatch",
    });
    expect(result.status).toBe("completed");
    expect(result.schemaName).toBe("employment_agreement");
    expect(result.extractionJson.overtimeType).toBe("global");
    expect(result.extractionJson.overtimeHours).toBe(20);
    expect(result.evidenceJson.overtimeType).toEqual({ page: 2, section: "שעות נוספות" });
    expect(result.provider).toBe("synthetic");
  });

  it("returns failed with no_provider_available when no fixture tag is supplied (the real-world default)", async () => {
    const result = await extractor.extract({
      documentId: "doc-1",
      documentType: "DOC-01",
      storagePath: "assessment-1/doc-1",
      sha256: "sha",
    });
    expect(result.status).toBe("failed");
    expect(result.failureReason).toBe("no_provider_available");
    expect(result.extractionJson).toEqual({});
  });

  it("returns failed with no_matching_fixture when the tagged fixture set has no data for this document type", async () => {
    const result = await extractor.extract({
      documentId: "doc-1",
      documentType: "DOC-08", // A-clean fixture set has no DOC-08 entry
      storagePath: "assessment-1/doc-1",
      sha256: "sha",
      fixtureTag: "A-clean",
    });
    expect(result.status).toBe("failed");
    expect(result.failureReason).toBe("no_matching_fixture");
  });

  it("returns failed with unsupported_document_type for an unknown document type", async () => {
    const result = await extractor.extract({
      documentId: "doc-1",
      documentType: "DOC-99",
      storagePath: "assessment-1/doc-1",
      sha256: "sha",
      fixtureTag: "A-clean",
    });
    expect(result.status).toBe("failed");
    expect(result.failureReason).toBe("unsupported_document_type");
  });

  it("never guesses — an uncertain/failed extraction always has an empty extractionJson", async () => {
    const noFixture = await extractor.extract({
      documentId: "doc-1",
      documentType: "DOC-03",
      storagePath: "p",
      sha256: "s",
    });
    expect(noFixture.extractionJson).toEqual({});
    expect(noFixture.confidenceJson).toEqual({});
  });

  it("extracts every document type present in the B fixture set consistently", async () => {
    const docTypes = ["DOC-01", "DOC-03", "DOC-04"];
    for (const documentType of docTypes) {
      const result = await extractor.extract({
        documentId: "doc-x",
        documentType,
        storagePath: "p",
        sha256: "s",
        fixtureTag: "B-overtime-mismatch",
      });
      expect(result.status).toBe("completed");
    }
  });
});
