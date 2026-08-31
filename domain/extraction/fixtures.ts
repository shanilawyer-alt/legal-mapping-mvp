import type { ExtractedField } from "@/domain/extraction/types";

/**
 * Canned, versioned synthetic extraction fixtures (OPEN_QUESTIONS.md
 * item 25) covering spec §22's fixtures A-D, scoped to the document
 * types the four spec-mandated cross-check demonstrations actually need
 * (PHASE_3_PLAN.md §8) — not an exhaustive matrix of every document type
 * × every fixture, which PILOT_READY does not require.
 */

function fv<T>(value: T | null, evidence?: { page?: number; section?: string }): ExtractedField<T> {
  return { value, evidence: evidence ?? null };
}

/** Fixture A (spec §22): small business, 3 employees, agreements exist, no exposure. */
export const FIXTURE_A_DOC01 = {
  employmentType: fv("שכיר", { page: 1 }),
  startDate: fv("2024-01-01"),
  jobTitle: fv("מוכר/ת"),
  salaryAmount: fv(6500),
  salaryBasis: fv("חודשי"),
  weeklyHours: fv(42),
  workDays: fv("א-ה"),
  overtimeType: fv("none"),
  overtimeAmount: fv(null),
  overtimeHours: fv(null),
  noticePeriod: fv("30 יום", { page: 2, section: "סיום העסקה" }),
  section14Reference: fv(true, { page: 2, section: "פיצויי פיטורים" }),
  section14Scope: fv("מלא"),
  severanceContributionRate: fv(8.33),
  pension: fv("צו הרחבה"),
  studyFund: fv("קיים"),
  bonusCommission: fv(null),
  trustPositionClause: fv(false),
  privacyMonitoringClauses: fv(null),
};

/**
 * Fixture B (spec §22): working-time exposure — 20 employees, 8
 * affected, global overtime clause assuming 20 hours, attendance
 * showing 34 actual hours, ongoing 18 months. Feeds the global-overtime
 * cross-check demonstration (spec §10/§21) and R-TIME-002/003.
 */
export const FIXTURE_B_DOC01 = {
  ...FIXTURE_A_DOC01,
  overtimeType: fv("global", { page: 2, section: "שעות נוספות" }),
  overtimeHours: fv(20, { page: 2, section: "שעות נוספות" }),
  section14Reference: fv(false),
};

export const FIXTURE_B_DOC03 = {
  baseSalary: fv(9000),
  regularHours: fv(182),
  overtime125Hours: fv(0),
  overtime150Hours: fv(0),
  globalOvertimeComponent: fv(true, { page: 1, section: "רכיבי שכר" }),
  globalOvertimeAmount: fv(2500, { page: 1, section: "רכיבי שכר" }), // matches spec §5's own example value
  bonus: fv(0),
  commission: fv(0),
  pensionEmployee: fv(540),
  pensionEmployer: fv(630),
  severance: fv(540),
  studyFund: fv(216),
  vacationBalance: fv(12),
  sickBalance: fv(8),
  payPeriod: fv("2026-06"),
};

export const FIXTURE_B_DOC04 = {
  period: fv("2026-06"),
  regularHours: fv(182),
  actualOvertimeHours: fv(34, { page: 1, section: "סיכום חודשי" }), // matches spec §5's own example value
  nightHours: fv(0),
  saturdayHolidayHours: fv(0),
  breaksRecorded: fv(true),
};

/**
 * Fixture C (spec §22): privacy exposure — cameras, a highly sensitive
 * area, inadequate notice. Feeds the privacy-contradiction cross-check
 * demonstration (spec §10/§21): the document reveals monitoring the
 * client's questionnaire answer said did not exist.
 */
export const FIXTURE_C_DOC07 = {
  dataCategories: fv("פרטי קשר, נוכחות, תיעוד ויזואלי"),
  purposes: fv("אבטחה"),
  mandatoryOrVoluntary: fv(null),
  controllerIdentity: fv(null),
  controllerContact: fv(null),
  recipients: fv(null),
  rightsDescribed: fv(false, { page: 1 }),
  camerasDisclosed: fv(false, { page: 1 }), // cameras exist per fixture, but notice omits them — the contradiction
  monitoringDisclosed: fv(false, { page: 1 }),
  biometricsDisclosed: fv(false),
  retentionPeriod: fv(null),
};

/**
 * Fixture D (spec §22): freelancer with no other clients, fixed hours,
 * personal performance required, company equipment/email, a manager,
 * leave approval required. Feeds the freelancer-indicator-aggregation
 * cross-check demonstration (spec §10/§21) and freelancer screening
 * (spec §13) — factual indicators only, never a legal-status conclusion.
 */
export const FIXTURE_D_DOC06 = {
  term: fv("שנתי, מתחדש"),
  paymentModel: fv("חודשי קבוע"),
  exclusivity: fv(true, { page: 1, section: "בלעדיות" }),
  personalPerformance: fv(true, { page: 1, section: "ביצוע אישי" }),
  substitutionAllowed: fv(false),
  controlOfHours: fv("business", { page: 2, section: "שעות עבודה" }),
  location: fv("משרדי העסק"),
  equipmentProvidedBy: fv("החברה", { page: 2, section: "ציוד" }),
  supervision: fv("מנהל ישיר"),
  terminationTerms: fv("הודעה מוקדמת 14 יום"),
  benefits: fv(null),
  companyEmailSystems: fv(true, { page: 2 }),
  contractorStatusWording: fv(true, { page: 1 }), // the agreement labels this "עצמאי" — a fact about the document, not a legal conclusion
};

export const SYNTHETIC_FIXTURES: Record<string, Record<string, Record<string, unknown>>> = {
  "A-clean": { "DOC-01": FIXTURE_A_DOC01 },
  "B-overtime-mismatch": {
    "DOC-01": FIXTURE_B_DOC01,
    "DOC-03": FIXTURE_B_DOC03,
    "DOC-04": FIXTURE_B_DOC04,
  },
  "C-privacy-gap": { "DOC-07": FIXTURE_C_DOC07 },
  "D-freelancer-dependency": { "DOC-06": FIXTURE_D_DOC06 },
};
