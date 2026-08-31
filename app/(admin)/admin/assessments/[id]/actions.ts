"use server";

import { redirect } from "next/navigation";
import { getRepositories } from "@/lib/db";
import { getDocumentStore } from "@/lib/storage";
import { getAdminUserId } from "@/lib/supabase/server";
import { reopenAssessment } from "@/domain/assessment/submission";
import { deleteDocumentAsAdmin } from "@/domain/documents/service";

/**
 * Server Actions for the admin assessment detail page. Both re-check
 * `getAdminUserId()` themselves even though `proxy.ts` already gates every
 * `/admin/*` request — see OPEN_QUESTIONS.md item 15. On any failure,
 * redirect back to the same detail page with `?error=...` rather than
 * throwing, so the page can render a plain-language explanation.
 */

export async function reopenAssessmentAction(assessmentId: string): Promise<void> {
  const detailUrl = `/admin/assessments/${assessmentId}`;
  const adminUserId = await getAdminUserId();
  if (!adminUserId) redirect("/admin/login");

  const repos = getRepositories();
  const result = await reopenAssessment(repos, assessmentId, adminUserId);
  if (!result.ok) {
    redirect(`${detailUrl}?error=${result.error}`);
  }
  redirect(detailUrl);
}

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
