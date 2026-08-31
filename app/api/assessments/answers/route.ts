import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getRepositories } from "@/lib/db";
import { getAnswersForSession, submitAnswerForSession } from "@/domain/assessment/session";
import { ASSESSMENT_SESSION_COOKIE } from "@/lib/security/sessionCookie";

/**
 * Session-scoped answers endpoint for the public questionnaire (spec
 * §2.1: "a client may access only her assessment"). Phase 1.1 hardening:
 * identity comes only from the HttpOnly `assessment_session` cookie
 * (never from a client-supplied token or assessmentId in the request) —
 * see domain/assessment/session.ts, the actual isolation boundary this
 * resolves through, and tests/session-isolation.test.ts / the
 * tests/api-*.integration.test.ts files, which exercise these exact
 * handlers.
 */

function errorStatus(error: "not_found" | "expired"): number {
  return error === "not_found" ? 404 : 410;
}

function readSessionToken(request: NextRequest): string | null {
  return request.cookies.get(ASSESSMENT_SESSION_COOKIE)?.value ?? null;
}

export async function GET(request: NextRequest) {
  const sessionToken = readSessionToken(request);
  if (!sessionToken) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const repos = getRepositories();
  const result = await getAnswersForSession(repos, sessionToken);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: errorStatus(result.error) });
  }

  return NextResponse.json({ answers: result.answers });
}

const submitAnswerSchema = z.object({
  questionId: z.string().min(1),
  value: z.unknown(),
});

export async function POST(request: NextRequest) {
  const sessionToken = readSessionToken(request);
  if (!sessionToken) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const body = await request.json().catch(() => null);
  const parsed = submitAnswerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const repos = getRepositories();
  const result = await submitAnswerForSession(
    repos,
    sessionToken,
    parsed.data.questionId,
    parsed.data.value,
  );
  if (!result.ok) {
    if (result.error === "unknown_question") {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    if (result.error === "invalid_answer") {
      return NextResponse.json(
        { error: result.error, validationError: result.validationError },
        { status: 400 },
      );
    }
    if (result.error === "locked") {
      return NextResponse.json({ error: result.error }, { status: 423 });
    }
    return NextResponse.json({ error: result.error }, { status: errorStatus(result.error) });
  }

  return NextResponse.json({ answer: result.answer });
}
