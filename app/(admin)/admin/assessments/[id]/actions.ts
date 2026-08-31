"use server";

import { redirect } from "next/navigation";
import { getRepositories } from "@/lib/db";
import { getDocumentStore } from "@/lib/storage";
import { getAdminUserId } from "@/lib/supabase/server";
import { deleteDocumentAsAdmin } from "@/domain/documents/service";

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
