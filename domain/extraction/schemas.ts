import { z } from "zod";

/**
 * One Zod schema per `document_analysis_matrix.csv` row's "מה ה-AI
 * מחלץ/בודק" column, keyed by documentType (DOC-01..DOC-08). Every
 * field carries page/section evidence (spec §8's "evidence by
 * page/section" requirement) via a uniform wrapper rather than bespoke
 * per-field shapes. The 5 document types spec §21's acceptance criteria
 * names explicitly (agreement, payslip, attendance, freelancer
 * agreement, privacy policy) get full field coverage per spec §8; the
 * other 3 (DOC-02, DOC-05, DOC-08) get a schema matching the CSV's own
 * column content, since spec doesn't detail them further.
 */

const evidence = z.object({ page: z.number().optional(), section: z.string().optional() }).nullable();

function field<T extends z.ZodTypeAny>(valueSchema: T) {
  return z.object({ value: valueSchema.nullable(), evidence }).nullable();
}

const str = () => field(z.string());
const num = () => field(z.number());
const bool = () => field(z.boolean());

/** DOC-01: הסכם עבודה (employment agreement) — spec §8. */
export const employmentAgreementSchema = z.object({
  employmentType: str(),
  startDate: str(),
  jobTitle: str(),
  salaryAmount: num(),
  salaryBasis: str(), // e.g. hourly/monthly/global
  weeklyHours: num(),
  workDays: str(),
  overtimeType: str(), // e.g. "global" | "hourly" | "none"
  overtimeAmount: num(),
  overtimeHours: num(),
  noticePeriod: str(),
  section14Reference: bool(),
  section14Scope: str(),
  severanceContributionRate: num(),
  pension: str(),
  studyFund: str(),
  bonusCommission: str(),
  trustPositionClause: bool(),
  privacyMonitoringClauses: str(),
});
export type EmploymentAgreementExtraction = z.infer<typeof employmentAgreementSchema>;

/** DOC-02: הודעה לעובד (notice of employment terms). */
export const employeeNoticeSchema = z.object({
  requiredDetailsPresent: bool(),
  matchesAgreement: bool(),
});

/** DOC-03: תלוש שכר (payslip) — spec §8. */
export const payslipSchema = z.object({
  baseSalary: num(),
  regularHours: num(),
  overtime125Hours: num(),
  overtime150Hours: num(),
  globalOvertimeComponent: bool(),
  globalOvertimeAmount: num(),
  bonus: num(),
  commission: num(),
  pensionEmployee: num(),
  pensionEmployer: num(),
  severance: num(),
  studyFund: num(),
  vacationBalance: num(),
  sickBalance: num(),
  payPeriod: str(),
});
export type PayslipExtraction = z.infer<typeof payslipSchema>;

/** DOC-04: דו"ח נוכחות (attendance report) — spec §8. */
export const attendanceSchema = z.object({
  period: str(),
  regularHours: num(),
  actualOvertimeHours: num(),
  nightHours: num(),
  saturdayHolidayHours: num(),
  breaksRecorded: bool(),
});
export type AttendanceExtraction = z.infer<typeof attendanceSchema>;

/** DOC-05: תכנית בונוסים/עמלות (bonus/commission plan). */
export const bonusPlanSchema = z.object({
  eligibilityConditions: str(),
  formula: str(),
  discretionary: bool(),
  paymentTiming: str(),
  terminationTreatment: str(),
});

/** DOC-06: הסכם פרילנסר (freelancer agreement) — spec §8. "Independent contractor" is a fact, not a legal conclusion. */
export const freelancerAgreementSchema = z.object({
  term: str(),
  paymentModel: str(),
  exclusivity: bool(),
  personalPerformance: bool(),
  substitutionAllowed: bool(),
  controlOfHours: str(), // e.g. "business" | "freelancer"
  location: str(),
  equipmentProvidedBy: str(),
  supervision: str(),
  terminationTerms: str(),
  benefits: str(),
  companyEmailSystems: bool(),
  contractorStatusWording: bool(), // presence of "independent contractor" wording — a fact, not a conclusion
});
export type FreelancerAgreementExtraction = z.infer<typeof freelancerAgreementSchema>;

/** DOC-07: הודעת/מדיניות פרטיות לעובדים (employee privacy notice/policy) — spec §8. */
export const privacyNoticeSchema = z.object({
  dataCategories: str(),
  purposes: str(),
  mandatoryOrVoluntary: str(),
  controllerIdentity: str(),
  controllerContact: str(),
  recipients: str(),
  rightsDescribed: bool(),
  camerasDisclosed: bool(),
  monitoringDisclosed: bool(),
  biometricsDisclosed: bool(),
  retentionPeriod: str(),
});
export type PrivacyNoticeExtraction = z.infer<typeof privacyNoticeSchema>;

/** DOC-08: תקנון למניעת הטרדה מינית (sexual harassment prevention policy). */
export const harassmentPolicySchema = z.object({
  policyExists: bool(),
  adaptedToOrganization: bool(),
  complaintChannelsDescribed: bool(),
  responsiblePersonNamed: bool(),
  publicationEvidence: bool(),
});

export const EXTRACTION_SCHEMAS_BY_DOCUMENT_TYPE: Record<string, z.ZodTypeAny> = {
  "DOC-01": employmentAgreementSchema,
  "DOC-02": employeeNoticeSchema,
  "DOC-03": payslipSchema,
  "DOC-04": attendanceSchema,
  "DOC-05": bonusPlanSchema,
  "DOC-06": freelancerAgreementSchema,
  "DOC-07": privacyNoticeSchema,
  "DOC-08": harassmentPolicySchema,
};

export const EXTRACTION_SCHEMA_NAMES_BY_DOCUMENT_TYPE: Record<string, string> = {
  "DOC-01": "employment_agreement",
  "DOC-02": "employee_notice",
  "DOC-03": "payslip",
  "DOC-04": "attendance",
  "DOC-05": "bonus_plan",
  "DOC-06": "freelancer_agreement",
  "DOC-07": "privacy_notice",
  "DOC-08": "harassment_policy",
};

export const EXTRACTION_SCHEMA_VERSION = "V1";
