import "server-only";
import type { Repositories } from "@/lib/db/repositories";
import type { Report } from "@/lib/db/types";
import type { DocumentStore } from "@/lib/storage/types";
import type { FreelancerScreeningResult } from "@/domain/rules/freelancerScreening";
import { buildReportData } from "@/domain/report/build";
import { renderReportHtml } from "@/domain/report/render";

/**
 * Generates one report preview (spec §G, PHASE_3_PLAN.md §11): builds
 * structured content from already-persisted findings/rule-evaluations,
 * renders it to a standalone HTML document, writes it to the same
 * private `DocumentStore` used for client document uploads (task #10 —
 * never a public URL, spec §7), and records a `reports` row. This is a
 * preview only — it never changes assessment status and never makes a
 * report client-visible; that boundary belongs to task #51's explicit
 * attorney approve/release actions.
 *
 * Audits `report_generated` (task #53) — MASTER_BUILD_SPEC.md §"audit_events"
 * lists this verbatim as one of the required coarse audit categories
 * ("Audit login, link creation, document access, analysis, finding
 * override, approval, report generation and deletion"). No content is
 * logged, only which report type/version was produced and by whom.
 *
 * `freelancerScreening` is supplied by the caller (task #50's
 * orchestration) rather than recomputed here, since deriving it needs
 * the assessment's full fact bundle (domain/facts) — out of scope for a
 * pure report-rendering module. Pass `null` when the assessment has no
 * freelancer-relevant answers.
 */
export async function generateReportPreview(
  repos: Repositories,
  store: DocumentStore,
  assessmentId: string,
  reportType: "internal" | "client",
  freelancerScreening: FreelancerScreeningResult | null,
  generatedBy: string | null,
): Promise<Report> {
  const [findings, evaluations, existingReports, extractions] = await Promise.all([
    repos.findings.listByAssessment(assessmentId),
    repos.ruleEvaluations.listByAssessment(assessmentId),
    repos.reports.listByAssessment(assessmentId),
    repos.documentExtractions.listByAssessment(assessmentId),
  ]);
  // Pilot-mode marker (safeguard: "synthetic report clearly marked" —
  // see PILOT_VALIDATION_PLAN.md's safeguards review). Real provenance
  // already recorded on document_extractions.provider, not a new flag.
  const usedSyntheticData = extractions.some((e) => e.provider === "synthetic" && e.status === "completed");

  const ruleEvaluationsById = new Map(evaluations.map((evaluation) => [evaluation.id, evaluation]));
  const data = buildReportData(
    assessmentId,
    reportType,
    findings,
    ruleEvaluationsById,
    freelancerScreening,
    usedSyntheticData,
  );
  const html = renderReportHtml(data);

  const version = existingReports.filter((r) => r.reportType === reportType).length + 1;
  const storagePath = `${assessmentId}/reports/${reportType}-v${version}.html`;

  await store.upload({ storagePath, data: Buffer.from(html, "utf-8"), mimeType: "text/html" });

  const report = await repos.reports.create({ assessmentId, reportType, version, storagePath, generatedBy });

  await repos.audit.record({
    actorType: generatedBy ? "admin" : "system",
    actorId: generatedBy,
    assessmentId,
    eventType: "report_generated",
    metadata: { reportId: report.id, reportType, version },
  });

  return report;
}
