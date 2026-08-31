"use server";

import { redirect } from "next/navigation";
import { getRepositories } from "@/lib/db";
import { getDocumentStore } from "@/lib/storage";
import { getAdminUserId } from "@/lib/supabase/server";
import { isPilotSyntheticModeEnabled } from "@/lib/security/env";
import { deleteDocumentAsAdmin } from "@/domain/documents/service";
import { runAnalysis } from "@/domain/analysis/runAnalysis";
import { reviewFinding } from "@/domain/review/reviewFinding";
import { approveAssessment } from "@/domain/review/approveAssessment";
import { releaseClientReport } from "@/domain/review/releaseClientReport";
import { generatePreviewForAssessment } from "@/domain/review/generatePreview";
import type { FindingReviewUpdate, FindingStatus } from "@/lib/db/types";

/**
 * Server Actions for the admin assessment detail page. Both re-check
 * `getAdminUserId()` themselves even though `proxy.ts` already gates every
 * `/admin/*` request — see OPEN_QUESTIONS.md item 15. On any failure,
 * redirect back to the same detail page with `?error=...` rather than
 * throwing, so the page can render a plain-language explanation.
 *
 * There is deliberately no reopenAssessmentAction here. `reopenAssessment()`
 * (domain/assessment/submission.ts) and `repos.assessments.reopen()` exist
 * at the architecture level, but reopen is a policy-sensitive operation —
 * who may do it, whether it should be unconditional, what it does to
 * existing findings/reports — and the source spec did not settle those
 * questions explicitly. See OPEN_QUESTIONS.md item 16: do not wire this
 * into any admin or client flow until that policy is approved.
 */

export async function deleteDocumentAction(assessmentId: string, documentId: string): Promise<void> {
  const detailUrl = `/admin/assessments/${assessmentId}`;
  const adminUserId = await getAdminUserId();
  if (!adminUserId) redirect("/admin/login");

  const repos = getRepositories();
  const store = getDocumentStore();
  const result = await deleteDocumentAsAdmin(repos, store, assessmentId, documentId, adminUserId);
  if (!result.ok) {
    redirect(`${detailUrl}?error=document_not_found`);
  }

  redirect(detailUrl);
}

/** Synthetic-only fixture tags a controlled pilot run may select (domain/extraction/fixtures.ts SYNTHETIC_FIXTURES) — never accepted as free text. */
const PILOT_FIXTURE_TAGS = ["A-clean", "B-overtime-mismatch", "C-privacy-gap", "D-freelancer-dependency"] as const;

/**
 * "Run Analysis" — SUBMITTED -> LAWYER_REVIEW (domain/analysis/runAnalysis.ts).
 *
 * The optional `pilotFixtureTag` field exists solely so a controlled,
 * attorney-run pilot (PILOT_VALIDATION_PLAN.md, PILOT_RUNBOOK.md) can
 * exercise the synthetic document-extraction path through the real
 * browser UI — no live AI provider exists in this environment
 * (OPEN_QUESTIONS.md item 25), so without a fixture tag every document
 * extraction correctly fails, exactly as it must for any real client's
 * real documents. It is honored only when `PILOT_SYNTHETIC_MODE_ENABLED`
 * is explicitly `"true"` (a deployment flag, absent/false by default —
 * see `lib/security/env.ts`) — a value submitted with pilot mode off is
 * silently ignored, not merely hidden in the UI, since this check runs
 * server-side regardless of what the client actually sent. Left blank,
 * or with pilot mode disabled, this behaves exactly as before: no
 * fixture tag is ever passed, and extraction fails gracefully rather
 * than guessing.
 */
export async function runAnalysisAction(assessmentId: string, formData: FormData): Promise<void> {
  const detailUrl = `/admin/assessments/${assessmentId}`;
  const adminUserId = await getAdminUserId();
  if (!adminUserId) redirect("/admin/login");

  const rawTag = isPilotSyntheticModeEnabled() ? formData.get("pilotFixtureTag") : null;
  const fixtureTag =
    typeof rawTag === "string" && (PILOT_FIXTURE_TAGS as readonly string[]).includes(rawTag)
      ? rawTag
      : undefined;

  const repos = getRepositories();
  const result = await runAnalysis(repos, assessmentId, fixtureTag ? { fixtureTag } : {});
  if (!result.ok) {
    redirect(`${detailUrl}?error=${result.error}`);
  }

  redirect(detailUrl);
}

const REVIEW_STATUSES: readonly FindingStatus[] = ["draft", "confirmed", "modified", "dismissed"];

/**
 * One Server Action backing all six spec §15 finding actions (confirm /
 * modify / dismiss / override severity / add note / visible-to-client
 * toggle) — each admin control on the page submits a different subset of
 * these form fields; only fields actually present in the submission are
 * included in the update.
 */
export async function reviewFindingAction(
  assessmentId: string,
  findingId: string,
  formData: FormData,
): Promise<void> {
  const detailUrl = `/admin/assessments/${assessmentId}`;
  const adminUserId = await getAdminUserId();
  if (!adminUserId) redirect("/admin/login");

  const repos = getRepositories();
  const update: FindingReviewUpdate = {};

  const status = formData.get("status");
  if (typeof status === "string" && REVIEW_STATUSES.includes(status as FindingStatus)) {
    update.status = status as FindingStatus;
  }

  const visibleToClientRaw = formData.get("visibleToClient");
  if (visibleToClientRaw !== null) {
    update.visibleToClient = visibleToClientRaw === "true";
  }

  const lawyerNotes = formData.get("lawyerNotes");
  if (typeof lawyerNotes === "string" && lawyerNotes.trim() !== "") {
    update.lawyerNotes = lawyerNotes;
  }

  const severityOverrideRaw = formData.get("severityOverride");
  if (typeof severityOverrideRaw === "string" && severityOverrideRaw.trim() !== "") {
    update.severityOverride = Number(severityOverrideRaw);
    const overrideReason = formData.get("overrideReason");
    update.overrideReason = typeof overrideReason === "string" ? overrideReason : null;
  }

  const result = await reviewFinding(repos, findingId, update, adminUserId);
  if (!result.ok) {
    redirect(`${detailUrl}?error=${result.error}`);
  }

  redirect(detailUrl);
}

/** "Approve" — LAWYER_REVIEW -> APPROVED, blocked by any draft CRITICAL finding (spec §15). */
export async function approveAssessmentAction(assessmentId: string): Promise<void> {
  const detailUrl = `/admin/assessments/${assessmentId}`;
  const adminUserId = await getAdminUserId();
  if (!adminUserId) redirect("/admin/login");

  const repos = getRepositories();
  const result = await approveAssessment(repos, assessmentId, adminUserId);
  if (!result.ok) {
    redirect(`${detailUrl}?error=${result.error}`);
  }

  redirect(detailUrl);
}

/** Generates one report preview (internal or client) — never releases anything. */
export async function generatePreviewAction(assessmentId: string, reportType: "internal" | "client"): Promise<void> {
  const detailUrl = `/admin/assessments/${assessmentId}`;
  const adminUserId = await getAdminUserId();
  if (!adminUserId) redirect("/admin/login");

  const repos = getRepositories();
  const store = getDocumentStore();
  await generatePreviewForAssessment(repos, store, assessmentId, reportType, adminUserId);

  redirect(detailUrl);
}

/** "Release" — APPROVED -> CLIENT_REPORT_RELEASED, the one explicit client-facing boundary. */
export async function releaseClientReportAction(assessmentId: string): Promise<void> {
  const detailUrl = `/admin/assessments/${assessmentId}`;
  const adminUserId = await getAdminUserId();
  if (!adminUserId) redirect("/admin/login");

  const repos = getRepositories();
  const store = getDocumentStore();
  const result = await releaseClientReport(repos, store, assessmentId, adminUserId);
  if (!result.ok) {
    redirect(`${detailUrl}?error=${result.error}`);
  }

  redirect(detailUrl);
}
