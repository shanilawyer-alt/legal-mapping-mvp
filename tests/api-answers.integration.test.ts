import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createInMemoryRepositories } from "@/lib/db/inMemory";
import { createAssessmentWithToken } from "@/domain/assessment/service";
import { createSessionForToken } from "@/domain/assessment/session";
import { ASSESSMENT_SESSION_COOKIE } from "@/lib/security/sessionCookie";
import type { Repositories } from "@/lib/db/repositories";

/**
 * Integration-level tests for the ACTUAL route handlers in
 * app/api/assessments/answers/route.ts — not a reimplementation of their
 * logic. lib/db's getRepositories() is mocked to return an in-memory
 * repository set (no live Supabase project is reachable from this
 * environment — see OPEN_QUESTIONS.md), but request parsing, cookie
 * reading, status codes, and response shapes are all exercised for real
 * through the real handler functions.
 */

let repos: Repositories;

vi.mock("@/lib/db", () => ({
  getRepositories: () => repos,
}));

beforeEach(() => {
  repos = createInMemoryRepositories();
});

const ANSWERS_URL = "http://localhost/api/assessments/answers";

function requestWithCookie(
  method: "GET" | "POST",
  cookieValue: string | null,
  body?: unknown,
) {
  const headers: Record<string, string> = {};
  if (cookieValue !== null) headers["cookie"] = `${ASSESSMENT_SESSION_COOKIE}=${cookieValue}`;
  if (body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(ANSWERS_URL, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

async function setupAssessmentWithSession(legalName: string) {
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

describe("GET /api/assessments/answers", () => {
  it("rejects a request with no session cookie at all", async () => {
    const { GET } = await import("@/app/api/assessments/answers/route");
    const res = await GET(requestWithCookie("GET", null));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
  });

  it("rejects a request with a garbage/forged session cookie", async () => {
    const { GET } = await import("@/app/api/assessments/answers/route");
    const res = await GET(requestWithCookie("GET", "not-a-real-session-token"));
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("not_found");
  });

  it("rejects an expired session", async () => {
    const org = await repos.organizations.create({ legalName: "עסק שפג" });
    const assessment = await repos.assessments.create({
      organizationId: org.id,
      secureTokenHash: "irrelevant-for-this-test",
      tokenExpiresAt: new Date(Date.now() + 1000 * 60 * 60),
      assessmentVersion: "V1",
      questionnaireVersion: "V1",
      ruleEngineVersion: "V1",
    });
    const { hashSecureToken, generateSecureToken } = await import("@/lib/security/token");
    const rawSessionToken = generateSecureToken();
    await repos.assessmentSessions.create({
      assessmentId: assessment.id,
      sessionTokenHash: hashSecureToken(rawSessionToken),
      expiresAt: new Date(Date.now() - 1000),
    });

    const { GET } = await import("@/app/api/assessments/answers/route");
    const res = await GET(requestWithCookie("GET", rawSessionToken));
    expect(res.status).toBe(410);
    expect((await res.json()).error).toBe("expired");
  });

  it("returns only the requesting assessment's own answers, never another assessment's", async () => {
    const a = await setupAssessmentWithSession("עסק א");
    const b = await setupAssessmentWithSession("עסק ב");

    const { POST, GET } = await import("@/app/api/assessments/answers/route");
    await POST(
      requestWithCookie("POST", a.rawSessionToken, { questionId: "GEN-01", value: "עוסק מורשה" }),
    );
    await POST(requestWithCookie("POST", a.rawSessionToken, { questionId: "GEN-04", value: 5 }));

    const resB = await GET(requestWithCookie("GET", b.rawSessionToken));
    expect(await resB.json()).toEqual({ answers: [] });

    const resA = await GET(requestWithCookie("GET", a.rawSessionToken));
    const bodyA = await resA.json();
    expect(bodyA.answers).toHaveLength(2);
    expect(bodyA.answers.every((ans: { assessmentId: string }) => ans.assessmentId === a.assessment.id)).toBe(
      true,
    );
  });
});

describe("POST /api/assessments/answers", () => {
  it("rejects a write with no session cookie", async () => {
    const { POST } = await import("@/app/api/assessments/answers/route");
    const res = await POST(requestWithCookie("POST", null, { questionId: "GEN-01", value: "x" }));
    expect(res.status).toBe(404);
  });

  it("rejects a malformed body (missing questionId)", async () => {
    const { rawSessionToken } = await setupAssessmentWithSession("עסק");
    const { POST } = await import("@/app/api/assessments/answers/route");
    const res = await POST(requestWithCookie("POST", rawSessionToken, { value: "x" }));
    expect(res.status).toBe(400);
  });

  it("a session for assessment B can never write into assessment A, even if the body claims A's id", async () => {
    const a = await setupAssessmentWithSession("עסק א");
    const b = await setupAssessmentWithSession("עסק ב");

    const { POST } = await import("@/app/api/assessments/answers/route");
    // The route's request schema doesn't even have an assessmentId field —
    // this extra key is silently ignored by Zod, not honored. Confirms the
    // write is scoped by the session cookie alone, not anything in the body.
    const maliciousBody = {
      questionId: "GEN-04",
      value: 999,
      assessmentId: a.assessment.id,
    };
    const res = await POST(requestWithCookie("POST", b.rawSessionToken, maliciousBody));
    expect(res.ok).toBe(true);

    const answersForA = await repos.answers.listByAssessment(a.assessment.id);
    expect(answersForA).toEqual([]);

    const answersForB = await repos.answers.listByAssessment(b.assessment.id);
    expect(answersForB).toHaveLength(1);
    expect(answersForB[0].questionId).toBe("GEN-04");
  });

  it("rejects a value that isn't one of the question's configured options", async () => {
    const { rawSessionToken } = await setupAssessmentWithSession("עסק");
    const { POST } = await import("@/app/api/assessments/answers/route");
    // GEN-01 (business type) is single_choice; "x" isn't a real option.
    const res = await POST(
      requestWithCookie("POST", rawSessionToken, { questionId: "GEN-01", value: "x" }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("invalid_answer");
    expect(body.validationError).toBe("invalid_option");
  });

  it("rejects a value of the wrong JS type for a numeric question", async () => {
    const { rawSessionToken } = await setupAssessmentWithSession("עסק");
    const { POST } = await import("@/app/api/assessments/answers/route");
    const res = await POST(
      requestWithCookie("POST", rawSessionToken, { questionId: "GEN-04", value: "five" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_answer");
  });

  it("rejects a questionId that doesn't exist in the questionnaire", async () => {
    const { rawSessionToken } = await setupAssessmentWithSession("עסק");
    const { POST } = await import("@/app/api/assessments/answers/route");
    const res = await POST(
      requestWithCookie("POST", rawSessionToken, { questionId: "NOT-A-REAL-QUESTION", value: "x" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("unknown_question");
  });

  it("accepts null to clear a previously-answered question", async () => {
    const { rawSessionToken } = await setupAssessmentWithSession("עסק");
    const { POST, GET } = await import("@/app/api/assessments/answers/route");
    await POST(requestWithCookie("POST", rawSessionToken, { questionId: "GEN-04", value: 5 }));
    const clearRes = await POST(
      requestWithCookie("POST", rawSessionToken, { questionId: "GEN-04", value: null }),
    );
    expect(clearRes.ok).toBe(true);

    const res = await GET(requestWithCookie("GET", rawSessionToken));
    const body = await res.json();
    expect(body.answers[0].valueJson).toBeNull();
  });

  it("normalizes a blank text answer to null rather than storing an empty string", async () => {
    const { rawSessionToken } = await setupAssessmentWithSession("עסק");
    const { POST, GET } = await import("@/app/api/assessments/answers/route");
    // GEN-02 is the free-text legal name field (short_text).
    const res = await POST(
      requestWithCookie("POST", rawSessionToken, { questionId: "GEN-02", value: "   " }),
    );
    expect(res.ok).toBe(true);

    const getRes = await GET(requestWithCookie("GET", rawSessionToken));
    const body = await getRes.json();
    expect(body.answers[0].valueJson).toBeNull();
  });
});
