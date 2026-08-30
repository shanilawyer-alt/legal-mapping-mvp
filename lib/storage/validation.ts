/** Pilot document formats (spec §7): PDF, DOCX, JPG/PNG; XLSX/CSV where appropriate. */
export const ALLOWED_MIME_TYPES = new Set([
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "image/jpeg",
  "image/png",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "text/csv",
]);

/** Reasonable size limit (spec §7): 20 MB per file. */
export const MAX_DOCUMENT_SIZE_BYTES = 20 * 1024 * 1024;

export interface DocumentValidationError {
  code: "unsupported_type" | "too_large" | "empty_file";
  message: string;
}

export function validateDocumentUpload(input: {
  mimeType: string;
  sizeBytes: number;
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
  if (!ALLOWED_MIME_TYPES.has(input.mimeType)) {
    return { code: "unsupported_type", message: "סוג קובץ אינו נתמך." };
  }
  return null;
}
