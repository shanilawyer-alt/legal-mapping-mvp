import { describe, expect, it } from "vitest";
import { sniffFileType } from "@/lib/security/fileSignature";

const PDF_BYTES = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n");
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00]);
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const ZIP_BYTES = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]);
const CSV_BYTES = Buffer.from("שם,גיל\nדני,30\nמיכל,25\n", "utf-8");
const NOT_TEXT_BYTES = Buffer.from([0xde, 0xad, 0xbe, 0xef, 0x00, 0x01, 0x02]);

describe("sniffFileType", () => {
  it("detects a PDF by its %PDF- signature", () => {
    expect(sniffFileType(PDF_BYTES)).toBe("pdf");
  });

  it("detects a PNG by its 8-byte signature", () => {
    expect(sniffFileType(PNG_BYTES)).toBe("png");
  });

  it("detects a JPEG by its FF D8 FF signature", () => {
    expect(sniffFileType(JPEG_BYTES)).toBe("jpeg");
  });

  it("detects a ZIP-based container (DOCX/XLSX) by its PK\\x03\\x04 signature", () => {
    expect(sniffFileType(ZIP_BYTES)).toBe("zip");
  });

  it("detects valid UTF-8 text (including Hebrew) as text, with no magic bytes", () => {
    expect(sniffFileType(CSV_BYTES)).toBe("text");
  });

  it("does not classify arbitrary binary garbage as text or any known type", () => {
    expect(sniffFileType(NOT_TEXT_BYTES)).toBe("unknown");
  });

  it("classifies a NUL-containing buffer as not-text even if otherwise ASCII", () => {
    const withNul = Buffer.concat([Buffer.from("looks,like,csv\n"), Buffer.from([0x00]), Buffer.from("but,isnt\n")]);
    expect(sniffFileType(withNul)).toBe("unknown");
  });

  it("classifies an empty buffer as unknown", () => {
    expect(sniffFileType(Buffer.alloc(0))).toBe("unknown");
  });

  it("does not match a signature against a buffer shorter than it", () => {
    // Truncated PNG signature — too short to match "png", and 0x89/0x50
    // aren't valid UTF-8 either, so it correctly falls through to unknown
    // rather than false-matching a shorter/different signature.
    expect(sniffFileType(Buffer.from([0x89, 0x50]))).toBe("unknown");
  });

  it("rejects a renamed-file attack: PNG bytes claimed as any other signature", () => {
    // The core threat model this module defends against: content sniffing
    // is independent of whatever extension/MIME type a client claims.
    expect(sniffFileType(PNG_BYTES)).not.toBe("pdf");
    expect(sniffFileType(PNG_BYTES)).not.toBe("zip");
    expect(sniffFileType(PNG_BYTES)).not.toBe("text");
  });
});
