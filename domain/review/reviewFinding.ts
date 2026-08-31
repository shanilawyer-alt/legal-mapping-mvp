import "server-only";
import type { Repositories } from "@/lib/db/repositories";
import type { Finding, FindingReviewUpdate } from "@/lib/db/types";

export type ReviewFindingResult =
  | { ok: true; finding: Finding }
  | { ok: false; error: "not_found" }
  | { ok: false; error: "override_requires_reason" };

/**
 * The six attorney finding actions spec §15 lists (confirm / modify /
 * dismiss / override severity / add note / visible-to-client toggle) all
 * reduce to one call here with a different partial `FindingReviewUpdate`
 * — the DB schema (Phase 1) has no separate action per button, just one
 * review record. `override_requires_reason` is validated here (not only
 * relying on the DB check constraint the in-memory/Postgres repos also
 * enforce) so callers get a typed result instead of a thrown error.
 */
export async function reviewFinding(
  repos: Repositories,
  findingId: string,
  update: FindingReviewUpdate,
  reviewedBy: string,
): Promise<ReviewFindingResult> {
  const existing = await repos.findings.getById(findingId);
  if (!existing) return { ok: false, error: "not_found" };

  if (update.severityOverride != null && !update.overrideReason) {
    return { ok: false, error: "override_requires_reason" };
  }

  const finding = await repos.findings.review(findingId, update, reviewedBy);

  await repos.audit.record({
    actorType: "admin",
    actorId: reviewedBy,
    assessmentId: existing.assessmentId,
    eventType: "finding_reviewed",
    metadata: {
      findingId,
      status: update.status ?? null,
      visibleToClient: update.visibleToClient ?? null,
      hasSeverityOverride: update.severityOverride != null,
    },
  });

  return { ok: true, finding };
}
