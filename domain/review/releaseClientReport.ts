import "server-only";
import type { Repositories } from "@/lib/db/repositories";
import type { Assessment, Report } from "@/lib/db/types";
import type { DocumentStore } from "@/lib/storage/types";
import { generatePreviewForAssessment } from "@/domain/review/generatePreview";

export type ReleaseClientReportResult =
  | { ok: true; assessment: Assessment; report: Report }
  | { ok: false; error: "not_found" }
  | { ok: false; error: "not_approved" };

/**
 * "Release" — APPROVED -> CLIENT_REPORT_RELEASED, the one explicit,
 * attorney-controlled boundary before anything reaches the client
 * (Phase 3 instruction's non-negotiable architecture). Only reachable
 * from APPROVED, which itself is only reachable once no CRITICAL
 * finding remains in `draft` (approveAssessment.ts) — release can never
 * be the first time an attorney reviews a finding.
 *
 * Generates one final client report snapshot at release time (rather
 * than releasing whatever preview happened to be generated last) so the
 * released version always reflects the assessment's state — including
 * every `visibleToClient` toggle — at the moment of release.
 */
export async function releaseClientReport(
  repos: Repositories,
  store: DocumentStore,
  assessmentId: string,
  releasedBy: string,
): Promise<ReleaseClientReportResult> {
  const assessment = await repos.assessments.getById(assessmentId);
  if (!assessment) return { ok: false, error: "not_found" };
  if (assessment.status !== "APPROVED") return { ok: false, error: "not_approved" };

  const report = await generatePreviewForAssessment(repos, store, assessmentId, "client", releasedBy);

  await repos.assessments.updateStatus(assessmentId, "CLIENT_REPORT_RELEASED");
  const updated = await repos.assessments.getById(assessmentId);
  if (!updated) return { ok: false, error: "not_found" };

  await repos.audit.record({
    actorType: "admin",
    actorId: releasedBy,
    assessmentId,
    eventType: "report_released",
    metadata: { reportId: report.id, storagePath: report.storagePath, version: report.version },
  });

  return { ok: true, assessment: updated, report };
}
