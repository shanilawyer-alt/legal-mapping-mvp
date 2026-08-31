import { describe, expect, it } from "vitest";
import { validateDocumentUpload, MAX_DOCUMENT_SIZE_BYTES } from "@/lib/storage/validation";
import { buildMinimalZip } from "./mocks/zip-fixture";

const PDF_BYTES = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n");
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46]);
/** A bare local-file-header stub — not a well-formed ZIP (no central directory/EOCD). */
const ZIP_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]);
const CSV_BYTES = Buffer.from("שם,גיל\nדני,30\n", "utf-8");
const EXE_BYTES = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]); // "MZ" PE header

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

const REAL_DOCX_BYTES = buildMinimalZip([
  "[Content_Types].xml",
  "_rels/.rels",
  "word/document.xml",
]);
const REAL_XLSX_BYTES = buildMinimalZip([
  "[Content_Types].xml",
  "_rels/.rels",
  "xl/workbook.xml",
]);
/** A well-formed ZIP that just isn't an OOXML document of either kind. */
const ARBITRARY_ZIP_BYTES = buildMinimalZip(["readme.txt", "data/notes.csv"]);

describe("validateDocumentUpload — allowed types accepted when content matches", () => {
  const cases: Array<[string, Buffer]> = [
    ["application/pdf", PDF_BYTES],
    ["image/png", PNG_BYTES],
    ["image/jpeg", JPEG_BYTES],
    [DOCX_MIME, REAL_DOCX_BYTES],
    [XLSX_MIME, REAL_XLSX_BYTES],
    ["text/csv", CSV_BYTES],
  ];

  for (const [mimeType, data] of cases) {
    it(`accepts ${mimeType} when the content matches its signature`, () => {
      const result = validateDocumentUpload({ mimeType, sizeBytes: data.byteLength, data });
      expect(result).toBeNull();
    });
  }
});

describe("validateDocumentUpload — disallowed / unsupported types rejected", () => {
  it("rejects a MIME type not on the allowlist regardless of content", () => {
    const result = validateDocumentUpload({
      mimeType: "application/x-msdownload",
      sizeBytes: EXE_BYTES.byteLength,
      data: EXE_BYTES,
    });
    expect(result?.code).toBe("unsupported_type");
  });

  it("rejects an empty file", () => {
    const result = validateDocumentUpload({
      mimeType: "application/pdf",
      sizeBytes: 0,
      data: Buffer.alloc(0),
    });
    expect(result?.code).toBe("empty_file");
  });
});

describe("validateDocumentUpload — size limits", () => {
  it("accepts a file exactly at the size limit", () => {
    const data = PDF_BYTES;
    const result = validateDocumentUpload({
      mimeType: "application/pdf",
      sizeBytes: MAX_DOCUMENT_SIZE_BYTES,
      data,
    });
    expect(result).toBeNull();
  });

  it("rejects a file one byte over the size limit", () => {
    const data = PDF_BYTES;
    const result = validateDocumentUpload({
      mimeType: "application/pdf",
      sizeBytes: MAX_DOCUMENT_SIZE_BYTES + 1,
      data,
    });
    expect(result?.code).toBe("too_large");
  });
});

describe("validateDocumentUpload — does not trust the declared MIME type alone", () => {
  it("rejects an executable renamed to claim application/pdf", () => {
    const result = validateDocumentUpload({
      mimeType: "application/pdf",
      sizeBytes: EXE_BYTES.byteLength,
      data: EXE_BYTES,
    });
    expect(result?.code).toBe("type_mismatch");
  });

  it("rejects a PNG's bytes uploaded with a claimed PDF content type", () => {
    const result = validateDocumentUpload({
      mimeType: "application/pdf",
      sizeBytes: PNG_BYTES.byteLength,
      data: PNG_BYTES,
    });
    expect(result?.code).toBe("type_mismatch");
  });

  it("rejects a JPEG's bytes uploaded with a claimed image/png content type", () => {
    const result = validateDocumentUpload({
      mimeType: "image/png",
      sizeBytes: JPEG_BYTES.byteLength,
      data: JPEG_BYTES,
    });
    expect(result?.code).toBe("type_mismatch");
  });

  it("rejects a ZIP claimed as text/csv", () => {
    const result = validateDocumentUpload({
      mimeType: "text/csv",
      sizeBytes: ZIP_BYTES.byteLength,
      data: ZIP_BYTES,
    });
    expect(result?.code).toBe("type_mismatch");
  });

  it("rejects binary content claimed as a DOCX (not actually a ZIP container)", () => {
    const result = validateDocumentUpload({
      mimeType: DOCX_MIME,
      sizeBytes: EXE_BYTES.byteLength,
      data: EXE_BYTES,
    });
    expect(result?.code).toBe("type_mismatch");
  });
});

describe("validateDocumentUpload — deep OOXML entry verification (item 7)", () => {
  it("rejects an arbitrary well-formed ZIP renamed to .docx", () => {
    const result = validateDocumentUpload({
      mimeType: DOCX_MIME,
      sizeBytes: ARBITRARY_ZIP_BYTES.byteLength,
      data: ARBITRARY_ZIP_BYTES,
    });
    expect(result?.code).toBe("ooxml_mismatch");
  });

  it("rejects an arbitrary well-formed ZIP renamed to .xlsx", () => {
    const result = validateDocumentUpload({
      mimeType: XLSX_MIME,
      sizeBytes: ARBITRARY_ZIP_BYTES.byteLength,
      data: ARBITRARY_ZIP_BYTES,
    });
    expect(result?.code).toBe("ooxml_mismatch");
  });

  it("rejects an XLSX's actual bytes uploaded declaring the DOCX MIME type", () => {
    const result = validateDocumentUpload({
      mimeType: DOCX_MIME,
      sizeBytes: REAL_XLSX_BYTES.byteLength,
      data: REAL_XLSX_BYTES,
    });
    expect(result?.code).toBe("ooxml_mismatch");
  });

  it("rejects a DOCX's actual bytes uploaded declaring the XLSX MIME type", () => {
    const result = validateDocumentUpload({
      mimeType: XLSX_MIME,
      sizeBytes: REAL_DOCX_BYTES.byteLength,
      data: REAL_DOCX_BYTES,
    });
    expect(result?.code).toBe("ooxml_mismatch");
  });

  it("rejects a ZIP that sniffs correctly but has a truncated/unparseable central directory", () => {
    // Same bare local-header stub used elsewhere: real "PK\x03\x04" magic
    // bytes (passes the outer signature sniff) but no central directory or
    // EOCD record at all.
    const result = validateDocumentUpload({
      mimeType: DOCX_MIME,
      sizeBytes: ZIP_BYTES.byteLength,
      data: ZIP_BYTES,
    });
    expect(result?.code).toBe("ooxml_mismatch");
  });

  it("does not apply the OOXML entry check to a plain (non-OOXML) ZIP consumer — e.g. text/csv stays a plain signature check", () => {
    // csv doesn't sniff as zip in the first place, so this should still be
    // a type_mismatch (the existing outer-signature check), not reach the
    // OOXML entry logic at all.
    const result = validateDocumentUpload({
      mimeType: "text/csv",
      sizeBytes: ARBITRARY_ZIP_BYTES.byteLength,
      data: ARBITRARY_ZIP_BYTES,
    });
    expect(result?.code).toBe("type_mismatch");
  });
});
