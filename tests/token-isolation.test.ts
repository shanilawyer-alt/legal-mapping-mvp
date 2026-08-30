import { describe, expect, it } from "vitest";
import { createInMemoryRepositories } from "@/lib/db/inMemory";
import {
  createAssessmentWithToken,
  getAnswersForToken,
  resolveAssessmentByToken,
  submitAnswerForToken,
} from "@/domain/assessment/service";
import { hashAssessmentToken, generateAssessmentToken } from "@/lib/security/token";

/**
 * Proves the invariant spec §2.1 requires: "a client may access only her
 * assessment." Every public-facing operation is reached only through a
 * verified token (never a caller-supplied assessmentId), so these tests
 * simulate the actual attack surface: what can holder of token B do to
 * assessment A's data?
 */

async function setupTwoAssessments() {
  const repos = createInMemoryRepositories();
  const orgA = await repos.organizations.create({ legalName: 'עסק א' });
  const orgB = await repos.organizations.create({ legalName: 'עסק ב' });

  const { assessment: assessmentA, rawToken: tokenA } = await createAssessmentWithToken(
    repos,
    { organizationId: orgA.id },
    "admin-1",
  );
  const { assessment: assessmentB, rawToken: tokenB } = await createAssessmentWithToken(
    repos,
    { organizationId: orgB.id },
    "admin-1",
  );

  return { repos, assessmentA, tokenA, assessmentB, tokenB };
}

describe("token isolation", () => {
  it("resolves each token to its own assessment only", async () => {
    const { repos, assessmentA, tokenA, assessmentB, tokenB } = await setupTwoAssessments();

    const resolvedA = await resolveAssessmentByToken(repos, tokenA);
    const resolvedB = await resolveAssessmentByToken(repos, tokenB);

    expect(resolvedA).toEqual({ ok: true, assessment: assessmentA });
    expect(resolvedB).toEqual({ ok: true, assessment: assessmentB });
    expect(resolvedA.ok && resolvedA.assessment.id).not.toBe(
      resolvedB.ok && resolvedB.assessment.id,
    );
  });

  it("never stores the raw token, only its hash", async () => {
    const { assessmentA, tokenA } = await setupTwoAssessments();
    expect(assessmentA.secureTokenHash).not.toBe(tokenA);
    expect(assessmentA.secureTokenHash).toBe(hashAssessmentToken(tokenA));
  });

  it("a client using token B can never read assessment A's answers", async () => {
    const { repos, tokenA, tokenB } = await setupTwoAssessments();

    await submitAnswerForToken(repos, tokenA, "GEN-01", "חברה בע\"מ");
    await submitAnswerForToken(repos, tokenA, "GEN-04", 12);

    const answersForB = await getAnswersForToken(repos, tokenB);
    expect(answersForB).toEqual({ ok: true, answers: [] });

    const answersForA = await getAnswersForToken(repos, tokenA);
    expect(answersForA.ok && answersForA.answers).toHaveLength(2);
  });

  it("a client using token B can never write into assessment A via submitAnswerForToken", async () => {
    const { repos, assessmentA, assessmentB, tokenB } = await setupTwoAssessments();

    const result = await submitAnswerForToken(repos, tokenB, "GEN-04", 999);
    expect(result.ok).toBe(true);
    expect(result.ok && result.answer.assessmentId).toBe(assessmentB.id);
    expect(result.ok && result.answer.assessmentId).not.toBe(assessmentA.id);

    const answersForA = await repos.answers.listByAssessment(assessmentA.id);
    expect(answersForA).toEqual([]);
  });

  it("a forged/garbage token resolves to not_found, not to any real assessment", async () => {
    const { repos } = await setupTwoAssessments();
    const forged = generateAssessmentToken(); // valid shape, never issued
    const result = await resolveAssessmentByToken(repos, forged);
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("an expired token is rejected even though it was validly issued", async () => {
    const repos = createInMemoryRepositories();
    const org = await repos.organizations.create({ legalName: "עסק שפג" });
    const rawToken = generateAssessmentToken();
    await repos.assessments.create({
      organizationId: org.id,
      secureTokenHash: hashAssessmentToken(rawToken),
      tokenExpiresAt: new Date(Date.now() - 1000), // already expired
      assessmentVersion: "V1",
      questionnaireVersion: "V1",
      ruleEngineVersion: "V1",
    });

    const result = await resolveAssessmentByToken(repos, rawToken);
    expect(result).toEqual({ ok: false, error: "expired" });

    const answers = await getAnswersForToken(repos, rawToken);
    expect(answers).toEqual({ ok: false, error: "expired" });
  });

  it("generateAssessmentToken produces unique, high-entropy tokens", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateAssessmentToken()));
    expect(tokens.size).toBe(1000);
    for (const token of tokens) {
      expect(token.length).toBeGreaterThanOrEqual(40); // 256 bits, base64url
    }
  });

  it("hashAssessmentToken is deterministic for the same token", () => {
    const token = generateAssessmentToken();
    expect(hashAssessmentToken(token)).toBe(hashAssessmentToken(token));
  });

  it("two different tokens never collide in secure_token_hash on create()", async () => {
    const repos = createInMemoryRepositories();
    const org = await repos.organizations.create({ legalName: "עסק" });
    const { rawToken: tokenA } = await createAssessmentWithToken(
      repos,
      { organizationId: org.id },
      "admin-1",
    );
    let secondTokenSameHashRejected = false;
    try {
      await repos.assessments.create({
        organizationId: org.id,
        secureTokenHash: hashAssessmentToken(tokenA),
        tokenExpiresAt: new Date(Date.now() + 1000 * 60),
        assessmentVersion: "V1",
        questionnaireVersion: "V1",
        ruleEngineVersion: "V1",
      });
    } catch {
      secondTokenSameHashRejected = true;
    }
    expect(secondTokenSameHashRejected).toBe(true);
  });
});
