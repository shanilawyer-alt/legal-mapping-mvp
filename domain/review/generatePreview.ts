import "server-only";
import type { Repositories } from "@/lib/db/repositories";
import type { Report } from "@/lib/db/types";
import type { DocumentStore } from "@/lib/storage/types";
import { loadQuestionnaire } from "@/domain/questionnaire/load";
import { buildFactBundle } from "@/domain/facts/bundle";
import { computeFreelancerScreening } from "@/domain/rules/freelancerScreening";
import { generateReportPreview } from "@/domain/report/generate";

/**
 * Assembles the assessment's current fact bundle and generates one
 * report preview (task #49) — the attorney-triggered "preview" action
 * spec §G and PILOT_READY step 12 require. Freelancer screening (spec
 * §13) is only computed for an internal preview: `buildReportData`
 * already ignores it for a client report (OPEN_QUESTIONS.md item 29 §3
 * — no level exists to show), so computing it for a client preview
 * would be wasted work, not a behavior difference.
 */
export async function generatePreviewForAssessment(
  repos: Repositories,
  store: DocumentStore,
  assessmentId: string,
  reportType: "internal" | "client",
  generatedBy: string,
): Promise<Report> {
  const [answers, storedFacts] = await Promise.all([
    repos.answers.listByAssessment(assessmentId),
    repos.derivedFacts.listByAssessment(assessmentId),
  ]);
  const items = loadQuestionnaire();
  const { map } = buildFactBundle({ answers, items, storedFacts });

  // report_structure.csv marks the Freelancer section "מותנה" (conditional)
  // — shown only when the business actually has freelancers, per GEN-06's
  // own ">0" trigger convention used throughout questionnaire.csv for the
  // FR-* question block.
  const hasFreelancers = typeof map["answer.GEN-06"] === "number" && map["answer.GEN-06"] > 0;
  const freelancerScreening = reportType === "internal" && hasFreelancers ? computeFreelancerScreening(map) : null;

  return generateReportPreview(repos, store, assessmentId, reportType, freelancerScreening, generatedBy);
}
