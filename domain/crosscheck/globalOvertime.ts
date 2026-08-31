import type { FactMap } from "@/domain/facts/types";
import type { CrossCheckIssue, CrossCheckOutcome } from "@/domain/crosscheck/types";

/**
 * Cross-check demonstration 2 (spec §10/§21): global overtime clause vs.
 * actual attendance/payslip. Produces the two fact keys `R-TIME-003` and
 * `R-PAY-002` in `domain/rules/catalog.ts` already reference by name —
 * this module is what makes those two rules decidable.
 *
 * Both comparisons are purely numeric/boolean fact comparisons — no
 * legal conclusion, wording, or severity is produced here.
 */
export function crossCheckGlobalOvertime(facts: FactMap): CrossCheckOutcome {
  const agreementOvertimeType = facts["document_extraction.employment_agreement.overtimeType"];
  const agreementOvertimeHours = facts["document_extraction.employment_agreement.overtimeHours"];
  const agreementOvertimeAmount = facts["document_extraction.employment_agreement.overtimeAmount"];
  const actualOvertimeHours = facts["document_extraction.attendance.actualOvertimeHours"];
  const payslipGlobalComponent = facts["document_extraction.payslip.globalOvertimeComponent"];
  const payslipGlobalAmount = facts["document_extraction.payslip.globalOvertimeAmount"];

  const globalClauseExists = agreementOvertimeType === "global";

  // The global clause assumes a fixed number of overtime hours are
  // "covered"; attendance records showing more actual overtime hours
  // than that means the clause no longer covers what actually happened.
  const attendanceMismatch =
    globalClauseExists &&
    typeof agreementOvertimeHours === "number" &&
    typeof actualOvertimeHours === "number" &&
    actualOvertimeHours > agreementOvertimeHours;

  // The payslip pays a global overtime component whose amount is either
  // unspecified in the contract, or numerically different from what the
  // contract states.
  const payslipMismatch =
    payslipGlobalComponent === true &&
    typeof payslipGlobalAmount === "number" &&
    (agreementOvertimeAmount === null ||
      agreementOvertimeAmount === undefined ||
      (typeof agreementOvertimeAmount === "number" && agreementOvertimeAmount !== payslipGlobalAmount));

  const facts_: Record<string, boolean> = {
    "cross_check.time.global_overtime_attendance_mismatch": attendanceMismatch,
    "cross_check.pay.contract_payslip_mismatch": payslipMismatch,
  };

  const issues: CrossCheckIssue[] = [];
  if (attendanceMismatch) {
    issues.push({
      factKey: "cross_check.time.global_overtime_attendance_mismatch",
      issueType: "mismatch",
      description:
        "Attendance records show more actual overtime hours than the employment agreement's global overtime clause assumes.",
      basedOn: [
        "document_extraction.employment_agreement.overtimeHours",
        "document_extraction.attendance.actualOvertimeHours",
      ],
    });
  }
  if (payslipMismatch) {
    issues.push({
      factKey: "cross_check.pay.contract_payslip_mismatch",
      issueType: "mismatch",
      description:
        "The payslip's global overtime component does not match the amount stated (or is unspecified) in the employment agreement.",
      basedOn: [
        "document_extraction.employment_agreement.overtimeAmount",
        "document_extraction.payslip.globalOvertimeAmount",
        "document_extraction.payslip.globalOvertimeComponent",
      ],
    });
  }

  return { facts: facts_, issues };
}
