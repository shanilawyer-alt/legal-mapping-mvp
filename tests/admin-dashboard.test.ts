import { beforeEach, describe, expect, it } from "vitest";
import { createInMemoryRepositories } from "@/lib/db/inMemory";
import { createAssessmentWithToken } from "@/domain/assessment/service";
import { createSessionForToken, submitAnswerForSession } from "@/domain/assessment/session";
import { listAdminAssessmentSummaries } from "@/domain/admin/dashboard";
import type { Repositories } from "@/lib/db/repositories";

let repos: Repositories;

beforeEach(() => {
  repos = createInMemoryRepositories();
});

async function createAssessment(legalName: string) {
  const org = await repos.organizations.create({ legalName });
  const { assessment, rawToken } = await createAssessmentWithToken(
    repos,
    { organizationId: org.id },
    "admin-1",
  );
  return { org, assessment, rawToken };
}

describe("listAdminAssessmentSummaries", () => {
  it("returns an empty list when there are no assessments", async () => {
    expect(await listAdminAssessmentSummaries(repos)).toEqual([]);
  });

  it("includes the organization's legal name and DRAFT status for a fresh assessment", async () => {
    await createAssessment("עסק חדש");
    const [summary] = await listAdminAssessmentSummaries(repos);
    expect(summary.organizationName).toBe("עסק חדש");
    expect(summary.status).toBe("DRAFT");
    expect(summary.submittedAt).toBeNull();
  });

  it("reflects employee/freelancer counts from GEN-04/GEN-06 answers, not organizations columns", async () => {
    const { rawToken } = await createAssessment("עסק");
    const session = await createSessionForToken(repos, rawToken);
    if (!session.ok) throw new Error("setup failed");

    const [summary] = await listAdminAssessmentSummaries(repos);
    expect(summary.employeeCount).toBeNull();
    expect(summary.freelancerCount).toBeNull();

    await submitAnswerForSession(repos, session.rawSessionToken, "GEN-04", 12);
    await submitAnswerForSession(repos, session.rawSessionToken, "GEN-06", 3);

    const [updated] = await listAdminAssessmentSummaries(repos);
    expect(updated.employeeCount).toBe(12);
    expect(updated.freelancerCount).toBe(3);
  });

  it("counts only currently-active core questions toward requiredAnswered/requiredTotal", async () => {
    const { rawToken } = await createAssessment("עסק");
    const session = await createSessionForToken(repos, rawToken);
    if (!session.ok) throw new Error("setup failed");

    const [before] = await listAdminAssessmentSummaries(repos);
    // GEN-01..GEN-03 are always-visible core questions; answering fewer
    // than requiredTotal must not read as complete.
    expect(before.requiredAnswered).toBe(0);
    expect(before.requiredTotal).toBeGreaterThan(0);

    await submitAnswerForSession(repos, session.rawSessionToken, "GEN-01", "עוסק מורשה");
    const [after] = await listAdminAssessmentSummaries(repos);
    expect(after.requiredAnswered).toBe(1);
    expect(after.requiredAnswered).toBeLessThan(after.requiredTotal);
  });

  it("does not count a stale (now-hidden) core answer toward requiredAnswered", async () => {
    const { rawToken } = await createAssessment("עסק");
    const session = await createSessionForToken(repos, rawToken);
    if (!session.ok) throw new Error("setup failed");

    await submitAnswerForSession(repos, session.rawSessionToken, "GEN-04", 5); // reveals EMP-* etc.
    const [withEmployees] = await listAdminAssessmentSummaries(repos);

    await submitAnswerForSession(repos, session.rawSessionToken, "GEN-04", 0); // hides them again
    const [withoutEmployees] = await listAdminAssessmentSummaries(repos);

    expect(withoutEmployees.requiredTotal).toBeLessThan(withEmployees.requiredTotal);
  });

  it("computes lastActivityAt from the most recent answer, not just assessment.updatedAt", async () => {
    const { rawToken } = await createAssessment("עסק");
    const session = await createSessionForToken(repos, rawToken);
    if (!session.ok) throw new Error("setup failed");

    const [before] = await listAdminAssessmentSummaries(repos);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await submitAnswerForSession(repos, session.rawSessionToken, "GEN-02", "טקסט");
    const [after] = await listAdminAssessmentSummaries(repos);

    expect(new Date(after.lastActivityAt).getTime()).toBeGreaterThan(
      new Date(before.lastActivityAt).getTime(),
    );
  });

  it("lists every assessment across organizations, isolated correctly", async () => {
    await createAssessment("עסק א");
    await createAssessment("עסק ב");
    const summaries = await listAdminAssessmentSummaries(repos);
    expect(summaries).toHaveLength(2);
    expect(summaries.map((s) => s.organizationName).sort()).toEqual(["עסק א", "עסק ב"]);
  });

  it("sorts newest-created assessment first", async () => {
    await createAssessment("ראשון");
    await new Promise((resolve) => setTimeout(resolve, 5));
    await createAssessment("שני");
    const summaries = await listAdminAssessmentSummaries(repos);
    expect(summaries[0].organizationName).toBe("שני");
    expect(summaries[1].organizationName).toBe("ראשון");
  });
});
