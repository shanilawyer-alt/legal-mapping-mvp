import type { AssessmentStatus } from "@/lib/db/types";

/** Hebrew labels for the admin UI — never shown to the client (spec: no legal-engine terminology in the client flow). */
export const ASSESSMENT_STATUS_LABELS: Record<AssessmentStatus, string> = {
  DRAFT: "טיוטה — בעיצומו",
  SUBMITTED: "נשלח — ממתין לניתוח",
  ANALYZED: "נותח",
  LAWYER_REVIEW: "בבדיקת עורך/ת דין",
  APPROVED: "אושר",
  CLIENT_REPORT_RELEASED: "דוח נשלח ללקוח",
};
