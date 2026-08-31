import { describe, expect, it } from "vitest";
import { listZipEntryNames } from "@/lib/security/zipEntries";
import { buildMinimalZip } from "./mocks/zip-fixture";

describe("listZipEntryNames", () => {
  it("lists a single entry name", () => {
    const zip = buildMinimalZip(["word/document.xml"]);
    expect(listZipEntryNames(zip)).toEqual(["word/document.xml"]);
  });

  it("lists multiple entry names in order", () => {
    const names = ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml"];
    const zip = buildMinimalZip(names);
    expect(listZipEntryNames(zip)).toEqual(names);
  });

  it("handles an empty archive (zero entries)", () => {
    const zip = buildMinimalZip([]);
    expect(listZipEntryNames(zip)).toEqual([]);
  });

  it("handles entry names containing non-ASCII (UTF-8) characters", () => {
    const zip = buildMinimalZip(["מסמך.xml"]);
    expect(listZipEntryNames(zip)).toEqual(["מסמך.xml"]);
  });

  it("returns null for a buffer too short to contain an EOCD record", () => {
    expect(listZipEntryNames(Buffer.from([0x50, 0x4b, 0x03, 0x04]))).toBeNull();
  });

  it("returns null for a bare local-file-header stub with no central directory", () => {
    const stub = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00]);
    expect(listZipEntryNames(stub)).toBeNull();
  });

  it("returns null when the central directory offset points past the end of the buffer", () => {
    const zip = buildMinimalZip(["a.txt"]);
    // Corrupt the EOCD's central-directory-offset field (bytes 16-19 of
    // the 22-byte EOCD record at the very end of the buffer).
    const corrupted = Buffer.from(zip);
    const eocdStart = corrupted.length - 22;
    corrupted.writeUInt32LE(0xffffff00, eocdStart + 16);
    expect(listZipEntryNames(corrupted)).toBeNull();
  });

  it("returns null when a central directory entry has the wrong signature", () => {
    const zip = buildMinimalZip(["a.txt"]);
    const corrupted = Buffer.from(zip);
    const eocdStart = corrupted.length - 22;
    const centralDirOffset = corrupted.readUInt32LE(eocdStart + 16);
    corrupted.writeUInt32LE(0xdeadbeef, centralDirOffset);
    expect(listZipEntryNames(corrupted)).toBeNull();
  });

  it("returns null for non-ZIP data entirely", () => {
    expect(listZipEntryNames(Buffer.from("just some plain text, not a zip at all"))).toBeNull();
  });

  it("does not require any entry's declared compressed/uncompressed size to be accurate (names only)", () => {
    // Regression guard: this reader must never attempt to read/decompress
    // entry content — it derives names purely from the central directory.
    const zip = buildMinimalZip(["word/document.xml"]);
    expect(() => listZipEntryNames(zip)).not.toThrow();
  });
});
