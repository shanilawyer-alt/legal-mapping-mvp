import { describe, expect, it } from "vitest";
import { createInMemoryRepositories } from "@/lib/db/inMemory";
import { createAssessmentWithToken } from "@/domain/assessment/service";
import {
  createSessionForToken,
  resolveAssessmentBySessionToken,
  getAnswersForSession,
  submitAnswerForSession,
} from "@/domain/assessment/session";
import { generateSecureToken, hashSecureToken, addHours } from "@/lib/security/token";

/**
 * Proves the token-isolation invariant for the actual ongoing-questionnaire
 * credential (Phase 1.1 hardening): the short-lived session minted from an
 * assessment token and carried afterward in an HttpOnly cookie. This is
 * what app/api/assessments/answers/route.ts and app/api/documents/route.ts
 * actually check on every request — see tests/api-answers.integration.test.ts
 * and tests/api-documents.integration.test.ts for the route-handler-level
 * version of the same guarantee.
 */

async function setupTwoAssessmentSessions() {
  const repos = createInMemoryRepositories();
  const orgA = await repos.organizations.create({ legalName: "עסק א" });
  const orgB = await repos.organizations.create({ legalName: "עסק ב" });

  const { rawToken: tokenA } = await createAssessmentWithToken(
    repos,
    { organizationId: orgA.id },
    "admin-1",
  );
  const { rawToken: tokenB } = await createAssessmentWithToken(
    repos,
    { organizationId: orgB.id },
    "admin-1",
  );

  const sessionA = await createSessionForToken(repos, tokenA);
  const sessionB = await createSessionForToken(repos, tokenB);
  if (!sessionA.ok || !sessionB.ok) throw new Error("setup failed");

  return { repos, sessionA, sessionB };
}

describe("session creation (token exchange)", () => {
  it("mints a session token distinct from the assessment token", async () => {
    const repos = createInMemoryRepositories();
    const org = await repos.organizations.create({ legalName: "עסק" });
    const { rawToken } = await createAssessmentWithToken(repos, { organizationId: org.id }, "admin-1");

    const result = await createSessionForToken(repos, rawToken);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rawSessionToken).not.toBe(rawToken);
  });

  it("never stores the raw session token, only its hash", async () => {
    const repos = createInMemoryRepositories();
    const org = await repos.organizations.create({ legalName: "עסק" });
    const { rawToken } = await createAssessmentWithToken(repos, { organizationId: org.id }, "admin-1");
    const result = await createSessionForToken(repos, rawToken);
    if (!result.ok) throw new Error("unexpected");

    const stored = await repos.assessmentSessions.findByTokenHash(
      hashSecureToken(result.rawSessionToken),
    );
    expect(stored).not.toBeNull();
    expect(stored?.sessionTokenHash).not.toBe(result.rawSessionToken);
  });

  it("a session can never outlive its parent assessment token", async () => {
    const repos = createInMemoryRepositories();
    const org = await repos.organizations.create({ legalName: "עסק שפג בקרוב" });
    // Token issued with only 1 hour of validity left — shorter than the
    // default 24h session lifetime.
    const rawToken = generateSecureToken();
    const assessment = await repos.assessments.create({
      organizationId: org.id,
      secureTokenHash: hashSecureToken(rawToken),
      tokenExpiresAt: addHours(1),
      assessmentVersion: "V1",
      questionnaireVersion: "V1",
      ruleEngineVersion: "V1",
    });

    const result = await createSessionForToken(repos, rawToken);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.sessionExpiresAt.getTime()).toBeLessThanOrEqual(
      new Date(assessment.tokenExpiresAt).getTime(),
    );
  });

  it("fails to create a session for an expired or unknown token", async () => {
    const repos = createInMemoryRepositories();
    const forged = await createSessionForToken(repos, generateSecureToken());
    expect(forged).toEqual({ ok: false, error: "not_found" });
  });
});

describe("session isolation", () => {
  it("resolves each session token to its own assessment only", async () => {
    const { repos, sessionA, sessionB } = await setupTwoAssessmentSessions();

    const resolvedA = await resolveAssessmentBySessionToken(repos, sessionA.rawSessionToken);
    const resolvedB = await resolveAssessmentBySessionToken(repos, sessionB.rawSessionToken);

    expect(resolvedA).toEqual({ ok: true, assessment: sessionA.assessment });
    expect(resolvedB).toEqual({ ok: true, assessment: sessionB.assessment });
    expect(resolvedA.ok && resolvedA.assessment.id).not.toBe(
      resolvedB.ok && resolvedB.assessment.id,
    );
  });

  it("a client holding session B can never read assessment A's answers", async () => {
    const { repos, sessionA, sessionB } = await setupTwoAssessmentSessions();

    await submitAnswerForSession(repos, sessionA.rawSessionToken, "GEN-01", 'חברה בע"מ');
    await submitAnswerForSession(repos, sessionA.rawSessionToken, "GEN-04", 12);

    const answersForB = await getAnswersForSession(repos, sessionB.rawSessionToken);
    expect(answersForB).toEqual({ ok: true, answers: [] });

    const answersForA = await getAnswersForSession(repos, sessionA.rawSessionToken);
    expect(answersForA.ok && answersForA.answers).toHaveLength(2);
  });

  it("a client holding session B can never write into assessment A", async () => {
    const { repos, sessionA, sessionB } = await setupTwoAssessmentSessions();

    const result = await submitAnswerForSession(repos, sessionB.rawSessionToken, "GEN-04", 999);
    expect(result.ok).toBe(true);
    expect(result.ok && result.answer.assessmentId).toBe(sessionB.assessment.id);
    expect(result.ok && result.answer.assessmentId).not.toBe(sessionA.assessment.id);

    const answersForA = await repos.answers.listByAssessment(sessionA.assessment.id);
    expect(answersForA).toEqual([]);
  });

  it("a forged/garbage session token resolves to not_found", async () => {
    const { repos } = await setupTwoAssessmentSessions();
    const forged = generateSecureToken(); // valid shape, never minted
    const result = await resolveAssessmentBySessionToken(repos, forged);
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("an expired session is rejected even though it was validly minted", async () => {
    const repos = createInMemoryRepositories();
    const org = await repos.organizations.create({ legalName: "עסק" });
    const assessment = await repos.assessments.create({
      organizationId: org.id,
      secureTokenHash: hashSecureToken(generateSecureToken()),
      tokenExpiresAt: addHours(48),
      assessmentVersion: "V1",
      questionnaireVersion: "V1",
      ruleEngineVersion: "V1",
    });
    const rawSessionToken = generateSecureToken();
    await repos.assessmentSessions.create({
      assessmentId: assessment.id,
      sessionTokenHash: hashSecureToken(rawSessionToken),
      expiresAt: new Date(Date.now() - 1000), // already expired
    });

    const result = await resolveAssessmentBySessionToken(repos, rawSessionToken);
    expect(result).toEqual({ ok: false, error: "expired" });

    const answers = await getAnswersForSession(repos, rawSessionToken);
    expect(answers).toEqual({ ok: false, error: "expired" });
  });

  it("the underlying assessment token is never accepted where a session token is expected", async () => {
    const { repos, sessionA } = await setupTwoAssessmentSessions();
    // sessionA.rawSessionToken is a fresh, independent random value — the
    // original assessment token that was exchanged for it must not also
    // work as a session token.
    const org = await repos.organizations.create({ legalName: "עסק אחר" });
    const { rawToken } = await createAssessmentWithToken(repos, { organizationId: org.id }, "admin-1");

    const result = await resolveAssessmentBySessionToken(repos, rawToken);
    expect(result).toEqual({ ok: false, error: "not_found" });
    expect(rawToken).not.toBe(sessionA.rawSessionToken);
  });
});
