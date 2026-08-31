import "server-only";
import type { Repositories } from "@/lib/db/repositories";
import type { Assessment } from "@/lib/db/types";

export type ApproveAssessmentResult =
  | { ok: true; assessment: Assessment }
  | { ok: false; error: "not_found" }
  | { ok: false; error: "not_lawyer_review" }
  | { ok: false; error: "unresolved_critical_findings"; blockingFindingIds: readonly string[] };

/**
 * "Approve" — LAWYER_REVIEW -> APPROVED. Spec §15, verbatim: "An
 * assessment cannot be approved with unresolved CRITICAL findings in
 * draft." — a CRITICAL finding still at `status: "draft"` blocks
 * approval; `confirmed`/`modified`/`dismissed` (any attorney disposition)
 * does not, regardless of the finding's final severity.
 */
export async function approveAssessment(
  repos: Repositories,
  assessmentId: string,
  approvedBy: string,
): Promise<ApproveAssessmentResult> {
  const assessment = await repos.assessments.getById(assessmentId);
  if (!assessment) return { ok: false, error: "not_found" };
  if (assessment.status !== "LAWYER_REVIEW") return { ok: false, error: "not_lawyer_review" };

  const findings = await repos.findings.listByAssessment(assessmentId);
  const blocking = findings.filter((f) => f.riskLevel === "CRITICAL" && f.status === "draft");
  if (blocking.length > 0) {
    return { ok: false, error: "unresolved_critical_findings", blockingFindingIds: blocking.map((f) => f.id) };
  }

  const approved = await repos.assessments.approve(assessmentId, approvedBy, new Date());

  await repos.audit.record({
    actorType: "admin",
    actorId: approvedBy,
    assessmentId,
    eventType: "assessment_approved",
  });

  return { ok: true, assessment: approved };
}
