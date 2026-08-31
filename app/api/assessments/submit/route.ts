import { NextResponse, type NextRequest } from "next/server";
import { getRepositories } from "@/lib/db";
import { submitAssessmentForSession } from "@/domain/assessment/submission";
import { ASSESSMENT_SESSION_COOKIE } from "@/lib/security/sessionCookie";

/**
 * Final client submission (Phase 2 spec item 2). Session-scoped, same
 * isolation boundary as app/api/assessments/answers/route.ts — identity
 * comes only from the HttpOnly session cookie. See
 * domain/assessment/submission.ts for the required-question check this
 * runs before flipping the assessment to SUBMITTED.
 */
export async function POST(request: NextRequest) {
  const sessionToken = request.cookies.get(ASSESSMENT_SESSION_COOKIE)?.value;
  if (!sessionToken) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const repos = getRepositories();
  const result = await submitAssessmentForSession(repos, sessionToken);

  if (!result.ok) {
    if (result.error === "missing_required") {
      return NextResponse.json(
        { error: result.error, missingQuestionIds: result.missingQuestionIds },
        { status: 422 },
      );
    }
    const status =
      result.error === "not_found" ? 404 : result.error === "expired" ? 410 : 423;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({ assessment: { id: result.assessment.id, status: result.assessment.status } });
}
