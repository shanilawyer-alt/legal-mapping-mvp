import { sniffFileType, type SniffedFileType } from "@/lib/security/fileSignature";
import { listZipEntryNames } from "@/lib/security/zipEntries";

/** Pilot document formats (spec §7): PDF, DOCX, JPG/PNG; XLSX/CSV where appropriate. */
export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "image/jpeg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "text/csv",
]);

/**
 * The content signature each allowed MIME type must actually sniff as.
 * DOCX and XLSX both sniff as "zip" (see lib/security/fileSignature.ts's
 * header comment on why that check stops there).
 */
const EXPECTED_SIGNATURE: Record<string, SniffedFileType> = {
  "application/pdf": "pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "zip",
  "image/jpeg": "jpeg",
  "image/png": "png",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "zip",
  "text/csv": "text",
};

/**
 * OOXML container formats (DOCX, XLSX) all sniff merely as "zip" by
 * signature alone — that only rules out a non-ZIP file renamed with an
 * OOXML extension, not an arbitrary ZIP renamed to .docx/.xlsx. This maps
 * each such MIME type to one internal entry that only that document kind
 * actually contains, so the archive's own contents are checked, not just
 * its outer container format (OPEN_QUESTIONS.md item 7).
 */
const REQUIRED_OOXML_ENTRY: Record<string, string> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "word/document.xml",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xl/workbook.xml",
};

/** Reasonable size limit (spec §7): 20 MB per file. */
export const MAX_DOCUMENT_SIZE_BYTES = 20 * 1024 * 1024;

export interface DocumentValidationError {
  code: "unsupported_type" | "too_large" | "empty_file" | "type_mismatch" | "ooxml_mismatch";
  message: string;
}

/**
 * Validates a document upload. `data` is required and is sniffed by
 * content (lib/security/fileSignature.ts) — the caller-supplied
 * `mimeType` (which on a real upload comes from the browser and is fully
 * attacker-controlled) is checked against the allowlist AND cross-checked
 * against what the file's actual bytes look like. A mismatch (e.g. an
 * .exe renamed to report.pdf with Content-Type: application/pdf) is
 * rejected as `type_mismatch`, not silently accepted.
 */
export function validateDocumentUpload(input: {
  mimeType: string;
  sizeBytes: number;
  data: Buffer;
}): DocumentValidationError | null {
  if (input.sizeBytes <= 0) {
    return { code: "empty_file", message: "הקובץ ריק." };
  }
  if (input.sizeBytes > MAX_DOCUMENT_SIZE_BYTES) {
    return {
      code: "too_large",
      message: `הקובץ חורג מהגודל המרבי המותר (${MAX_DOCUMENT_SIZE_BYTES / (1024 * 1024)}MB).`,
    };
  }
  const expectedSignature = EXPECTED_SIGNATURE[input.mimeType];
  if (!expectedSignature) {
    return { code: "unsupported_type", message: "סוג קובץ אינו נתמך." };
  }
  const sniffed = sniffFileType(input.data);
  if (sniffed !== expectedSignature) {
    return {
      code: "type_mismatch",
      message: "תוכן הקובץ אינו תואם את סוג הקובץ המוצהר.",
    };
  }

  const requiredEntry = REQUIRED_OOXML_ENTRY[input.mimeType];
  if (requiredEntry) {
    const entryNames = listZipEntryNames(input.data);
    if (!entryNames || !entryNames.includes(requiredEntry)) {
      return {
        code: "ooxml_mismatch",
        message: "הקובץ הוא ארכיון ZIP, אך אינו מסמך Office תקין מהסוג המוצהר.",
      };
    }
  }

  return null;
}
