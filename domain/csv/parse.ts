import { parse } from "csv-parse/sync";
import type { z } from "zod";

export interface RowValidationError {
  rowNumber: number; // 1-based, counting only data rows (header excluded)
  raw: Record<string, string>;
  message: string;
}

export interface ParseCsvResult<T> {
  rows: T[];
  errors: RowValidationError[];
}

/**
 * Parses CSV text (with a header row) and validates every row against the
 * given Zod schema. Never throws on a bad row — it collects every failure
 * so the importer can report all of them at once, per FIRST_PROMPT's
 * "CSV import/validation scripts" deliverable.
 */
export function parseCsv<T>(
  csvText: string,
  rowSchema: z.ZodType<T>,
): ParseCsvResult<T> {
  const records: Record<string, string>[] = parse(csvText, {
    columns: true,
    bom: true,
    skip_empty_lines: true,
    trim: false,
  });

  const rows: T[] = [];
  const errors: RowValidationError[] = [];

  records.forEach((record, index) => {
    const result = rowSchema.safeParse(record);
    if (result.success) {
      rows.push(result.data);
    } else {
      errors.push({
        rowNumber: index + 1,
        raw: record,
        message: result.error.issues
          .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
          .join("; "),
      });
    }
  });

  return { rows, errors };
}
