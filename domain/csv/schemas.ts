import { z } from "zod";

/**
 * One Zod schema per source CSV, keyed by the file's actual Hebrew/English
 * column headers verbatim. These are intentionally *not* renamed to English
 * identifiers: constraint #5 in the handoff prompt requires preserving
 * Hebrew wording, and keeping the header text as the schema key means a
 * mismatch between the CSV and the schema fails loudly (Zod reports the
 * exact missing/extra column) instead of silently misaligning columns.
 */

const nonEmpty = (label: string) => z.string().trim().min(1, `${label} is required`);
const optional = () => z.string().trim().optional().default("");

export const questionnaireRowSchema = z.object({
  ID: nonEmpty("ID"),
  "תחום": nonEmpty("תחום"),
  "תת-תחום": optional(),
  "נוסח השאלה ללקוח": nonEmpty("נוסח השאלה ללקוח"),
  "סוג תשובה": nonEmpty("סוג תשובה"),
  "אפשרויות / פורמט": optional(),
  "מתי מוצג (Trigger)": optional(),
  "שאלת המשך / פעולה": optional(),
  "מסמך להעלאה": optional(),
  "בדיקה פנימית בשלב הניתוח": optional(),
  "שירות/צורך שעשוי להתגלות": optional(),
  "ליבה/מותנה": nonEmpty("ליבה/מותנה"),
});
export type QuestionnaireRow = z.infer<typeof questionnaireRowSchema>;

export const ruleCatalogRowSchema = z.object({
  "Rule ID": nonEmpty("Rule ID"),
  "תחום": nonEmpty("תחום"),
  "ממצא/נושא": nonEmpty("ממצא/נושא"),
  "קלטים": optional(),
  "תנאי לוגי V1": optional(),
  "סטטוס מוצע": optional(),
  "חומרה בסיסית 1-5": nonEmpty("חומרה בסיסית 1-5"),
  "Override קריטי?": optional(),
  "ראיה נדרשת": optional(),
  "חישוב היקף": optional(),
  "משך": optional(),
  "שיטתיות": optional(),
  "המלצה ראשונית": optional(),
  "שירות אפשרי": optional(),
  "מקור משפטי": optional(),
  "אוטומציה": optional(),
  "הערת זהירות": optional(),
});
export type RuleCatalogRow = z.infer<typeof ruleCatalogRowSchema>;

export const freelancerScreeningRowSchema = z.object({
  "שאלה": nonEmpty("שאלה"),
  "אינדיקציה": nonEmpty("אינדיקציה"),
  "תנאי": optional(),
  "נקודות Screening": nonEmpty("נקודות Screening"),
  "כיוון": nonEmpty("כיוון"),
  "הערה": optional(),
  "מקור": optional(),
  "אוטומטי": optional(),
});
export type FreelancerScreeningRow = z.infer<typeof freelancerScreeningRowSchema>;

export const exposureFactorRowSchema = z.object({
  "ממד": nonEmpty("ממד"),
  "ערך/קטגוריה": nonEmpty("ערך/קטגוריה"),
  "נקודות": nonEmpty("נקודות"),
  "הסבר": optional(),
  "נכנס לציון?": optional(),
  "שימוש": optional(),
  "הערה": optional(),
  "גרסה": optional(),
});
export type ExposureFactorRow = z.infer<typeof exposureFactorRowSchema>;

export const documentAnalysisRowSchema = z.object({
  ID: nonEmpty("ID"),
  "סוג מסמך": nonEmpty("סוג מסמך"),
  "מה מבקשים מהלקוח": optional(),
  "מה ה-AI מחלץ/בודק": optional(),
  "שאלות מקושרות": optional(),
  "הערה משפטית": optional(),
});
export type DocumentAnalysisRow = z.infer<typeof documentAnalysisRowSchema>;

export const reportStructureRowSchema = z.object({
  "שכבה": nonEmpty("שכבה"),
  "שדה": nonEmpty("שדה"),
  "פלט ללקוח": optional(),
  "פלט מקצועי": optional(),
  "מקור": optional(),
  "מוצג תמיד?": optional(),
  "הערה": optional(),
  "גרסה": optional(),
});
export type ReportStructureRow = z.infer<typeof reportStructureRowSchema>;

export const legalSourceRowSchema = z.object({
  "נושא": nonEmpty("נושא"),
  "מקור": nonEmpty("מקור"),
  "עיקרון למנוע": optional(),
  URL: optional(),
  "סטטוס/עדכון": optional(),
});
export type LegalSourceRow = z.infer<typeof legalSourceRowSchema>;
