import type { FactMap } from "@/domain/facts/types";
import type { CrossCheckIssue, CrossCheckOutcome } from "@/domain/crosscheck/types";

/**
 * The `document_analysis_matrix.csv` DOC-07 row lists the components a
 * privacy notice is checked for: "מטרות; חובה/רשות למסירת מידע;
 * שימושים; העברות; בעל שליטה ופרטי קשר; זכויות; מצלמות/ניטור ככל
 * שרלוונטי" (purposes; mandatory/voluntary; uses; transfers; controller
 * identity and contact; rights; cameras/monitoring where relevant) —
 * mapped onto the existing `privacyNoticeSchema` fields already
 * extracted for exactly those components.
 */
const REQUIRED_STRING_COMPONENTS = [
  "purposes",
  "mandatoryOrVoluntary",
  "dataCategories",
  "recipients",
  "controllerIdentity",
  "controllerContact",
] as const;

function isEmptyComponent(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

/**
 * Cross-check demonstration 3 (spec §10/§21): privacy-notice
 * completeness (feeds R-PRIV-001's second OR clause,
 * "מסמך חסר רכיבי יידוע"), and a monitoring-disclosure contradiction —
 * the client's questionnaire says no monitoring is used (PRIV-19 =
 * ["אין"]) while the uploaded privacy notice's own text describes
 * monitoring means (cameras/GPS/etc.) that exist.
 */
export function crossCheckPrivacy(facts: FactMap): CrossCheckOutcome {
  const componentsIncomplete =
    REQUIRED_STRING_COMPONENTS.some((field) =>
      isEmptyComponent(facts[`document_extraction.privacy_notice.${field}`]),
    ) || facts["document_extraction.privacy_notice.rightsDescribed"] !== true;

  const priv19 = facts["answer.PRIV-19"];
  const clientReportsNoMonitoring =
    Array.isArray(priv19) && priv19.length === 1 && priv19[0] === "אין";

  const documentDescribesMonitoring = !isEmptyComponent(
    facts["document_extraction.privacy_notice.monitoringMeansDescribed"],
  );

  const contradiction = clientReportsNoMonitoring && documentDescribesMonitoring;

  const factsOut: Record<string, boolean> = {
    "document_extraction.privacy_notice.components_incomplete": componentsIncomplete,
    "cross_check.privacy.location_monitoring_contradiction": contradiction,
  };

  const issues: CrossCheckIssue[] = [];
  if (componentsIncomplete) {
    issues.push({
      factKey: "document_extraction.privacy_notice.components_incomplete",
      issueType: "missing_expected_evidence",
      description: "The uploaded privacy notice is missing one or more required components.",
      basedOn: REQUIRED_STRING_COMPONENTS.map((f) => `document_extraction.privacy_notice.${f}`),
    });
  }
  if (contradiction) {
    issues.push({
      factKey: "cross_check.privacy.location_monitoring_contradiction",
      issueType: "contradiction",
      description:
        "The client reported no monitoring is used (PRIV-19), but the uploaded privacy notice describes monitoring means in use.",
      basedOn: ["answer.PRIV-19", "document_extraction.privacy_notice.monitoringMeansDescribed"],
    });
  }

  return { facts: factsOut, issues };
}
