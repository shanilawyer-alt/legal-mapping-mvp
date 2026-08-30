import { describe, expect, it } from "vitest";
import { createInMemoryRepositories } from "@/lib/db/inMemory";
import { createAssessmentWithToken, resolveAssessmentByToken } from "@/domain/assessment/service";
import { generateSecureToken, hashSecureToken } from "@/lib/security/token";

/**
 * Proves the token-isolation invariant for the assessment access token
 * itself — the credential an admin generates once and sends to a client
 * (domain/assessment/service.ts). This token is now used exactly once, to
 * exchange for a session (see domain/assessment/session.ts and
 * tests/session-isolation.test.ts, which covers the isolation invariant
 * for the ongoing questionnaire session that credential exchanges into).
 */

async function setupTwoAssessments() {
  const repos = createInMemoryRepositories();
  const orgA = await repos.organizations.create({ legalName: "עסק א" });
  const orgB = await repos.organizations.create({ legalName: "עסק ב" });

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

describe("assessment token isolation", () => {
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
    expect(assessmentA.secureTokenHash).toBe(hashSecureToken(tokenA));
  });

  it("a forged/garbage token resolves to not_found, not to any real assessment", async () => {
    const { repos } = await setupTwoAssessments();
    const forged = generateSecureToken(); // valid shape, never issued
    const result = await resolveAssessmentByToken(repos, forged);
    expect(result).toEqual({ ok: false, error: "not_found" });
  });

  it("an expired token is rejected even though it was validly issued", async () => {
    const repos = createInMemoryRepositories();
    const org = await repos.organizations.create({ legalName: "עסק שפג" });
    const rawToken = generateSecureToken();
    await repos.assessments.create({
      organizationId: org.id,
      secureTokenHash: hashSecureToken(rawToken),
      tokenExpiresAt: new Date(Date.now() - 1000), // already expired
      assessmentVersion: "V1",
      questionnaireVersion: "V1",
      ruleEngineVersion: "V1",
    });

    const result = await resolveAssessmentByToken(repos, rawToken);
    expect(result).toEqual({ ok: false, error: "expired" });
  });

  it("generateSecureToken produces unique, high-entropy tokens", () => {
    const tokens = new Set(Array.from({ length: 1000 }, () => generateSecureToken()));
    expect(tokens.size).toBe(1000);
    for (const token of tokens) {
      expect(token.length).toBeGreaterThanOrEqual(40); // 256 bits, base64url
    }
  });

  it("hashSecureToken is deterministic for the same token", () => {
    const token = generateSecureToken();
    expect(hashSecureToken(token)).toBe(hashSecureToken(token));
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
        secureTokenHash: hashSecureToken(tokenA),
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
