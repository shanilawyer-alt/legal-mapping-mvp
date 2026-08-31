import type { FactMap } from "@/domain/facts/types";
import type { CrossCheckOutcome } from "@/domain/crosscheck/types";

const AGREEMENT_EXISTS = ["כן, עם כולם", "רק עם חלקם"];
const NOTICE_MISSING_OR_PARTIAL = ["לא", "רק לחלקם"];

/**
 * Cross-check demonstration 1 (spec §10/§21): EMP-01 (written employment
 * agreement) vs. EMP-02 (written notice of employment terms).
 * `questionnaire.csv`'s own EMP-02 internal-check column says this
 * verbatim: "להצליב עם EMP-01: אם אין הודעה אך יש הסכם — לבדוק אם
 * ההסכם ממלא את דרישות הדין" (cross-reference with EMP-01: if there is
 * no notice but an agreement exists — check whether the agreement
 * fulfills the legal requirements).
 *
 * This is a deliberately `requires_attorney_review` outcome, not an
 * automatic finding: EMP-01's own internal-check column separately
 * warns "אין להסיק כשלעצמו שעמדה חובת הודעה לעובד" (the agreement's
 * existence alone must not be taken to mean the notice obligation was
 * met) — whether the agreement's content actually covers the legally
 * required notice details is not something this deterministic
 * cross-check can decide; only an attorney reading the agreement can.
 */
export function crossCheckEmployeeNotice(facts: FactMap): CrossCheckOutcome {
  const agreementAnswer = facts["answer.EMP-01"];
  const noticeAnswer = facts["answer.EMP-02"];

  const requiresReview =
    typeof agreementAnswer === "string" &&
    AGREEMENT_EXISTS.includes(agreementAnswer) &&
    typeof noticeAnswer === "string" &&
    NOTICE_MISSING_OR_PARTIAL.includes(noticeAnswer);

  const factsOut: Record<string, boolean> = {
    "cross_check.employee_notice.requires_contract_coverage_check": requiresReview,
  };

  const issues: CrossCheckOutcome["issues"] = requiresReview
    ? [
        {
          factKey: "cross_check.employee_notice.requires_contract_coverage_check",
          issueType: "requires_attorney_review",
          description:
            "A written employment agreement exists but a separate notice of employment terms was not given (or not to everyone) — whether the agreement itself covers the legally required notice details requires attorney review.",
          basedOn: ["answer.EMP-01", "answer.EMP-02"],
        },
      ]
    : [];

  return { facts: factsOut, issues };
}
