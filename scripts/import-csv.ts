#!/usr/bin/env tsx
/**
 * CSV import/validation script (FIRST_PROMPT_FOR_CLAUDE_CODE.md Phase 1
 * deliverable).
 *
 * Reads all 7 source CSVs from /data, validates each row against a Zod
 * schema matching the file's real headers, checks ID uniqueness and
 * cross-file referential integrity, and — only if there are zero errors —
 * writes normalized JSON snapshots to /data/generated for the app to read
 * at build/boot time (the running app never re-parses raw CSV per
 * request).
 *
 * Usage:
 *   tsx scripts/import-csv.ts             # validate + write snapshots
 *   tsx scripts/import-csv.ts --check     # validate only, no writes
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import {
  questionnaireRowSchema,
  ruleCatalogRowSchema,
  freelancerScreeningRowSchema,
  exposureFactorRowSchema,
  documentAnalysisRowSchema,
  reportStructureRowSchema,
  legalSourceRowSchema,
} from "../domain/csv/schemas";
import { parseCsv, type RowValidationError } from "../domain/csv/parse";
import { findDanglingQuestionRefs, findDuplicateIds } from "../domain/csv/referential";
import { normalizeQuestionnaireRow } from "../domain/questionnaire/normalize";

const DATA_DIR = join(__dirname, "..", "data");
const OUT_DIR = join(DATA_DIR, "generated");

interface Report {
  file: string;
  rowCount: number;
  errors: string[];
}

function readCsv(filename: string): string {
  return readFileSync(join(DATA_DIR, filename), "utf-8");
}

function fail(reports: Report[]): never {
  console.error("\nCSV import failed. Problems found:\n");
  for (const report of reports) {
    if (report.errors.length === 0) continue;
    console.error(`--- ${report.file} ---`);
    for (const err of report.errors) console.error(`  ${err}`);
  }
  process.exit(1);
}

function main() {
  const checkOnly = process.argv.includes("--check");
  const reports: Report[] = [];

  // --- questionnaire.csv ---
  const questionnaireCsv = readCsv("questionnaire.csv");
  const questionnaireParsed = parseCsv(questionnaireCsv, questionnaireRowSchema);
  const questionnaireErrors: string[] = formatRowErrors(questionnaireParsed.errors);

  const dupQuestionIds = findDuplicateIds(questionnaireParsed.rows.map((r) => r.ID));
  if (dupQuestionIds.length > 0) {
    questionnaireErrors.push(`Duplicate question IDs: ${dupQuestionIds.join(", ")}`);
  }

  const questionnaireItems: ReturnType<typeof normalizeQuestionnaireRow>[] = [];
  for (const row of questionnaireParsed.rows) {
    try {
      questionnaireItems.push(normalizeQuestionnaireRow(row));
    } catch (err) {
      questionnaireErrors.push(err instanceof Error ? err.message : String(err));
    }
  }

  const knownQuestionIds = new Set(questionnaireItems.map((q) => q.id));

  // Every trigger that references another question must reference a real one.
  for (const item of questionnaireItems) {
    for (const ref of findDanglingQuestionRefs(
      item.triggerRaw,
      knownQuestionIds,
      `questionnaire.csv: ${item.id} (trigger)`,
    )) {
      questionnaireErrors.push(
        `${ref.source} references unknown question ID "${ref.referencedId}"`,
      );
    }
  }

  reports.push({
    file: "questionnaire.csv",
    rowCount: questionnaireParsed.rows.length,
    errors: questionnaireErrors,
  });

  // --- document_analysis_matrix.csv (parsed early: rule_catalog "קלטים" can
  // reference either a question ID or a document ID, e.g. "DOC-01") ---
  const docMatrixCsv = readCsv("document_analysis_matrix.csv");
  const docMatrixParsed = parseCsv(docMatrixCsv, documentAnalysisRowSchema);
  const docMatrixErrors: string[] = formatRowErrors(docMatrixParsed.errors);
  const dupDocIds = findDuplicateIds(docMatrixParsed.rows.map((r) => r.ID));
  if (dupDocIds.length > 0) {
    docMatrixErrors.push(`Duplicate document IDs: ${dupDocIds.join(", ")}`);
  }
  for (const row of docMatrixParsed.rows) {
    for (const ref of findDanglingQuestionRefs(
      row["שאלות מקושרות"],
      knownQuestionIds,
      `document_analysis_matrix.csv: ${row.ID} (שאלות מקושרות)`,
    )) {
      docMatrixErrors.push(
        `${ref.source} references unknown question ID "${ref.referencedId}"`,
      );
    }
  }
  reports.push({
    file: "document_analysis_matrix.csv",
    rowCount: docMatrixParsed.rows.length,
    errors: docMatrixErrors,
  });

  const knownDocIds = new Set(docMatrixParsed.rows.map((r) => r.ID));
  const knownQuestionOrDocIds = new Set([...knownQuestionIds, ...knownDocIds]);

  // --- rule_catalog.csv ---
  const ruleCatalogCsv = readCsv("rule_catalog.csv");
  const ruleCatalogParsed = parseCsv(ruleCatalogCsv, ruleCatalogRowSchema);
  const ruleCatalogErrors: string[] = formatRowErrors(ruleCatalogParsed.errors);

  const dupRuleIds = findDuplicateIds(ruleCatalogParsed.rows.map((r) => r["Rule ID"]));
  if (dupRuleIds.length > 0) {
    ruleCatalogErrors.push(`Duplicate Rule IDs: ${dupRuleIds.join(", ")}`);
  }

  for (const row of ruleCatalogParsed.rows) {
    for (const ref of findDanglingQuestionRefs(
      row["קלטים"],
      knownQuestionOrDocIds,
      `rule_catalog.csv: ${row["Rule ID"]} (קלטים)`,
    )) {
      ruleCatalogErrors.push(
        `${ref.source} references unknown question/document ID "${ref.referencedId}"`,
      );
    }
    const severity = Number(row["חומרה בסיסית 1-5"]);
    if (!Number.isInteger(severity) || severity < 1 || severity > 5) {
      ruleCatalogErrors.push(
        `rule_catalog.csv: ${row["Rule ID"]} has out-of-range severity "${row["חומרה בסיסית 1-5"]}" (expected integer 1-5)`,
      );
    }
  }

  reports.push({
    file: "rule_catalog.csv",
    rowCount: ruleCatalogParsed.rows.length,
    errors: ruleCatalogErrors,
  });

  // --- freelancer_screening_model.csv ---
  const freelancerCsv = readCsv("freelancer_screening_model.csv");
  const freelancerParsed = parseCsv(freelancerCsv, freelancerScreeningRowSchema);
  const freelancerErrors: string[] = formatRowErrors(freelancerParsed.errors);
  for (const row of freelancerParsed.rows) {
    for (const ref of findDanglingQuestionRefs(
      row["שאלה"],
      knownQuestionIds,
      `freelancer_screening_model.csv (שאלה="${row["שאלה"]}")`,
    )) {
      freelancerErrors.push(
        `${ref.source} references unknown question ID "${ref.referencedId}"`,
      );
    }
  }
  reports.push({
    file: "freelancer_screening_model.csv",
    rowCount: freelancerParsed.rows.length,
    errors: freelancerErrors,
  });

  // --- exposure_factors.csv ---
  const exposureCsv = readCsv("exposure_factors.csv");
  const exposureParsed = parseCsv(exposureCsv, exposureFactorRowSchema);
  reports.push({
    file: "exposure_factors.csv",
    rowCount: exposureParsed.rows.length,
    errors: formatRowErrors(exposureParsed.errors),
  });

  // --- report_structure.csv ---
  const reportStructureCsv = readCsv("report_structure.csv");
  const reportStructureParsed = parseCsv(reportStructureCsv, reportStructureRowSchema);
  reports.push({
    file: "report_structure.csv",
    rowCount: reportStructureParsed.rows.length,
    errors: formatRowErrors(reportStructureParsed.errors),
  });

  // --- legal_sources.csv ---
  const legalSourcesCsv = readCsv("legal_sources.csv");
  const legalSourcesParsed = parseCsv(legalSourcesCsv, legalSourceRowSchema);
  reports.push({
    file: "legal_sources.csv",
    rowCount: legalSourcesParsed.rows.length,
    errors: formatRowErrors(legalSourcesParsed.errors),
  });

  const totalErrors = reports.reduce((sum, r) => sum + r.errors.length, 0);
  if (totalErrors > 0) fail(reports);

  console.log("CSV import validation passed:");
  for (const report of reports) {
    console.log(`  ${report.file}: ${report.rowCount} rows OK`);
  }

  if (checkOnly) return;

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    join(OUT_DIR, "questionnaire.json"),
    JSON.stringify(questionnaireItems, null, 2),
  );
  writeFileSync(
    join(OUT_DIR, "rule_catalog.json"),
    JSON.stringify(ruleCatalogParsed.rows, null, 2),
  );
  writeFileSync(
    join(OUT_DIR, "freelancer_screening_model.json"),
    JSON.stringify(freelancerParsed.rows, null, 2),
  );
  writeFileSync(
    join(OUT_DIR, "exposure_factors.json"),
    JSON.stringify(exposureParsed.rows, null, 2),
  );
  writeFileSync(
    join(OUT_DIR, "document_analysis_matrix.json"),
    JSON.stringify(docMatrixParsed.rows, null, 2),
  );
  writeFileSync(
    join(OUT_DIR, "report_structure.json"),
    JSON.stringify(reportStructureParsed.rows, null, 2),
  );
  writeFileSync(
    join(OUT_DIR, "legal_sources.json"),
    JSON.stringify(legalSourcesParsed.rows, null, 2),
  );

  console.log(`\nWrote validated snapshots to ${OUT_DIR}`);
}

function formatRowErrors(errors: RowValidationError[]): string[] {
  return errors.map((e) => `row ${e.rowNumber}: ${e.message}`);
}

main();
