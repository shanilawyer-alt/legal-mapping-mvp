import { cookies } from "next/headers";
import { getRepositories } from "@/lib/db";
import { resolveAssessmentBySessionToken } from "@/domain/assessment/session";
import { loadQuestionnaire, groupByDomain } from "@/domain/questionnaire/load";
import type { AnswerMap } from "@/domain/branching/evaluate";
import { AssessmentShell } from "@/app/(public)/assessment/assessment-shell";
import { AccessError } from "@/components/assessment/access-error";
import { ASSESSMENT_SESSION_COOKIE } from "@/lib/security/sessionCookie";

/**
 * The clean, token-free questionnaire URL (Phase 1.1 hardening). Reached
 * either by a successful redirect from the token-exchange endpoint
 * (app/(public)/assessment/[token]/route.ts) or directly by a browser that
 * still has a valid, unexpired session cookie from an earlier visit.
 * Never reads a token from its own URL — identity comes only from the
 * HttpOnly session cookie.
 */
export default async function AssessmentPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  if (error === "not_found" || error === "expired") {
    return <AccessError error={error} />;
  }

  const cookieStore = await cookies();
  const sessionToken = cookieStore.get(ASSESSMENT_SESSION_COOKIE)?.value;

  if (!sessionToken) {
    return <AccessError error="not_found" />;
  }

  const repos = getRepositories();
  const resolved = await resolveAssessmentBySessionToken(repos, sessionToken);

  if (!resolved.ok) {
    return <AccessError error={resolved.error} />;
  }

  const answers = await repos.answers.listByAssessment(resolved.assessment.id);
  const initialAnswers: AnswerMap = Object.fromEntries(
    answers.map((a) => [a.questionId, a.valueJson as never]),
  );

  const sections = groupByDomain(loadQuestionnaire());

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-200 bg-slate-50 px-4 py-4 text-center">
        <h1 className="text-lg font-semibold text-slate-900">מיפוי משפטי לעסק</h1>
        <p className="mt-1 text-sm text-slate-500">
          כל תשובה נשמרת אוטומטית. ניתן לצאת ולחזור באמצעות הקישור שנשלח אליך.
        </p>
      </header>
      <AssessmentShell sections={sections} initialAnswers={initialAnswers} />
    </div>
  );
}
