import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createInMemoryRepositories } from "@/lib/db/inMemory";
import { createAssessmentWithToken } from "@/domain/assessment/service";
import { createSessionForToken, submitAnswerForSession } from "@/domain/assessment/session";
import { loadQuestionnaire } from "@/domain/questionnaire/load";
import { evaluateCondition, type AnswerValue } from "@/domain/branching/evaluate";
import { ASSESSMENT_SESSION_COOKIE } from "@/lib/security/sessionCookie";
import type { Repositories } from "@/lib/db/repositories";
import type { QuestionnaireItem } from "@/domain/questionnaire/types";

/**
 * Integration-level tests for the ACTUAL route handler in
 * app/api/assessments/submit/route.ts — mirrors the pattern in
 * tests/api-answers.integration.test.ts.
 */

let repos: Repositories;

vi.mock("@/lib/db", () => ({
  getRepositories: () => repos,
}));

beforeEach(() => {
  repos = createInMemoryRepositories();
});

const SUBMIT_URL = "http://localhost/api/assessments/submit";

function requestWithCookie(cookieValue: string | null) {
  const headers: Record<string, string> = {};
  if (cookieValue !== null) headers["cookie"] = `${ASSESSMENT_SESSION_COOKIE}=${cookieValue}`;
  return new NextRequest(SUBMIT_URL, { method: "POST", headers });
}

async function setupSession(legalName: string) {
  const org = await repos.organizations.create({ legalName });
  const { assessment, rawToken } = await createAssessmentWithToken(
    repos,
    { organizationId: org.id },
    "admin-1",
  );
  const session = await createSessionForToken(repos, rawToken);
  if (!session.ok) throw new Error("setup failed");
  return { assessment, rawSessionToken: session.rawSessionToken };
}

function generateValidValue(item: QuestionnaireItem): AnswerValue {
  switch (item.answerType) {
    case "short_text":
      return "טקסט לדוגמה";
    case "number":
    case "hours":
      return 5;
    case "yes_no":
    case "yes_no_unknown":
      return "כן";
    case "single_choice":
      return item.options?.[0] ?? "";
    case "multi_choice":
      return item.options?.[0] ? [item.options[0]] : [];
  }
}

async function answerAllCoreQuestions(rawSessionToken: string) {
  const items = loadQuestionnaire();
  const accum: Record<string, AnswerValue> = {};
  for (const item of items) {
    if (evaluateCondition(item.triggerCondition, accum) && item.isCore) {
      const value = generateValidValue(item);
      accum[item.id] = value;
      await submitAnswerForSession(repos, rawSessionToken, item.id, value);
    }
  }
}

describe("POST /api/assessments/submit", () => {
  it("rejects a request with no session cookie", async () => {
    const { POST } = await import("@/app/api/assessments/submit/route");
    const res = await POST(requestWithCookie(null));
    expect(res.status).toBe(404);
  });

  it("returns 422 with the list of missing required questions when incomplete", async () => {
    const { rawSessionToken } = await setupSession("עסק לא מלא");
    const { POST } = await import("@/app/api/assessments/submit/route");
    const res = await POST(requestWithCookie(rawSessionToken));
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error).toBe("missing_required");
    expect(Array.isArray(body.missingQuestionIds)).toBe(true);
    expect(body.missingQuestionIds.length).toBeGreaterThan(0);
  });

  it("submits successfully once every required question is answered", async () => {
    const { rawSessionToken } = await setupSession("עסק מלא");
    await answerAllCoreQuestions(rawSessionToken);

    const { POST } = await import("@/app/api/assessments/submit/route");
    const res = await POST(requestWithCookie(rawSessionToken));
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.assessment.status).toBe("SUBMITTED");
  });

  it("returns 423 (locked) on a second submit attempt", async () => {
    const { rawSessionToken } = await setupSession("עסק");
    await answerAllCoreQuestions(rawSessionToken);
    const { POST } = await import("@/app/api/assessments/submit/route");
    await POST(requestWithCookie(rawSessionToken));

    const res = await POST(requestWithCookie(rawSessionToken));
    expect(res.status).toBe(423);
    expect((await res.json()).error).toBe("locked");
  });

  it("never accepts an assessmentId or any other identifier from the request — session cookie only", async () => {
    const a = await setupSession("עסק א");
    await answerAllCoreQuestions(a.rawSessionToken);

    // Confirms the handler takes no request body at all (nothing to forge).
    const { POST } = await import("@/app/api/assessments/submit/route");
    const res = await POST(requestWithCookie(a.rawSessionToken));
    expect(res.ok).toBe(true);
    const body = await res.json();
    expect(body.assessment.id).toBe(a.assessment.id);
  });
});
