import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getRepositories } from "@/lib/db";
import { getAnswersForToken, submitAnswerForToken } from "@/domain/assessment/service";

/**
 * Token-scoped answers endpoint for the public questionnaire (spec §2.1:
 * "a client may access only her assessment"). Neither handler accepts an
 * assessmentId from the caller — only a token, verified server-side, which
 * domain/assessment/service.ts resolves to the one assessment it belongs
 * to. This is the structural guarantee tested in
 * tests/token-isolation.test.ts.
 *
 * The token travels in a header on GET and in the JSON body on POST rather
 * than the query string/URL, so it does not end up in ordinary access
 * logs the way a URL-embedded token would.
 */

function errorStatus(error: "not_found" | "expired"): number {
  return error === "not_found" ? 404 : 410;
}

export async function GET(request: NextRequest) {
  const token = request.headers.get("x-assessment-token");
  if (!token) {
    return NextResponse.json({ error: "missing_token" }, { status: 400 });
  }

  const repos = getRepositories();
  const result = await getAnswersForToken(repos, token);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: errorStatus(result.error) });
  }

  return NextResponse.json({ answers: result.answers });
}

const submitAnswerSchema = z.object({
  token: z.string().min(1),
  questionId: z.string().min(1),
  value: z.unknown(),
});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = submitAnswerSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const repos = getRepositories();
  const result = await submitAnswerForToken(
    repos,
    parsed.data.token,
    parsed.data.questionId,
    parsed.data.value,
  );
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: errorStatus(result.error) });
  }

  return NextResponse.json({ answer: result.answer });
}
