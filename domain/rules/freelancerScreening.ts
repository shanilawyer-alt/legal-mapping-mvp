import type { FactMap } from "@/domain/facts/types";

/**
 * Freelancer screening — spec §13, using `freelancer_screening_model.csv`'s
 * 14 indicator rows exactly. Screening only: it aggregates factual
 * indicators and never determines legal employment status. Per
 * OPEN_QUESTIONS.md item 27, no source file defines numeric thresholds
 * for a LOW/MEDIUM/SIGNIFICANT/HIGH band, so this function does not
 * compute one — only the raw point total and which indicators
 * contributed (spec §13: "Show attorney which indicators contributed"),
 * for the attorney's own judgment.
 */

/** Spec §13's mandatory wording, verbatim (see OPEN_QUESTIONS.md item 27 for why this is English, not a self-translated Hebrew sentence). */
export const FREELANCER_SCREENING_DISCLOSURE =
  "The screening score reflects accumulated factual indicators and does not determine the legal status of the service provider.";

export interface ScreeningIndicator {
  questionId: string; // "שאלה"
  indication: string; // "אינדיקציה"
  condition: string; // "תנאי"
  points: number; // "נקודות Screening" — already signed (+/-)
  direction: "מעלה סיכון" | "מעלה במעט" | "מפחית סיכון"; // "כיוון", verbatim
  note: string; // "הערה"
}

export interface ScreeningIndicatorResult extends ScreeningIndicator {
  contributed: boolean;
}

export interface FreelancerScreeningResult {
  totalPoints: number;
  indicators: readonly ScreeningIndicatorResult[];
  disclosure: string;
}

/**
 * Each entry corresponds to exactly one `freelancer_screening_model.csv`
 * row. FR-04 and FR-06 each appear twice because the CSV itself defines
 * two distinct, mutually-exclusive indicators keyed to the same question
 * (e.g. FR-04 = "לא" triggers the dependency indicator; FR-04 = "כן"
 * triggers the separate "has other clients" indicator) — never both from
 * one answer. Every `condition` below matches a real
 * `questionnaire.csv` FR-* option string exactly.
 */
const SCREENING_MODEL: readonly (ScreeningIndicator & { evaluate: (facts: FactMap) => boolean })[] = [
  {
    questionId: "FR-04",
    indication: "תלות/בלעדיות",
    condition: "אין לקוחות אחרים",
    points: 10,
    direction: "מעלה סיכון",
    note: "תלות כלכלית היא אינדיקציה בלבד.",
    evaluate: (f) => f["answer.FR-04"] === "לא",
  },
  {
    questionId: "FR-05",
    indication: "שליטה בשעות",
    condition: "העסק קובע את השעות",
    points: 10,
    direction: "מעלה סיכון",
    note: "רלוונטי לכפיפות ולשליטה.",
    evaluate: (f) => f["answer.FR-05"] === "העסק",
  },
  {
    questionId: "FR-06",
    indication: "ביצוע אישי",
    condition: "חייב לבצע אישית",
    points: 10,
    direction: "מעלה סיכון",
    note: "מאפיין מרכזי ביחסי עבודה.",
    evaluate: (f) => f["answer.FR-06"] === "חייב לבצע אישית",
  },
  {
    questionId: "FR-07",
    indication: "כפיפות",
    condition: "מנהל נותן הוראות שוטפות",
    points: 10,
    direction: "מעלה סיכון",
    note: "יש להבחין בין פיקוח מקצועי טבעי לבין כפיפות ארגונית.",
    evaluate: (f) => f["answer.FR-07"] === "כן",
  },
  {
    questionId: "FR-08",
    indication: "מקום",
    condition: "עובד בעיקר במשרדי העסק",
    points: 5,
    direction: "מעלה סיכון",
    note: "משקל נמוך יחסית, תלוי בתחום.",
    evaluate: (f) => f["answer.FR-08"] === "במשרדי העסק",
  },
  {
    questionId: "FR-09",
    indication: "ציוד",
    condition: "העסק מספק את עיקר הציוד",
    points: 5,
    direction: "מעלה סיכון",
    note: "תלוי במקצוע ובמודל העסקי.",
    evaluate: (f) => f["answer.FR-09"] === "העסק",
  },
  {
    questionId: "FR-10",
    indication: "השתלבות ארגונית",
    condition: "מייל/מערכות/אתר כחלק מהצוות",
    points: 10,
    direction: "מעלה סיכון",
    note: "אינדיקציה חזקה להשתלבות.",
    evaluate: (f) => f["answer.FR-10"] === "כן",
  },
  {
    questionId: "FR-11",
    indication: "השתלבות ארגונית",
    condition: "משתתף שוטף בישיבות/הדרכות",
    points: 5,
    direction: "מעלה סיכון",
    note: "תלוי באופי ההתקשרות.",
    evaluate: (f) => f["answer.FR-11"] === "כן",
  },
  {
    questionId: "FR-12",
    indication: "שליטה בהיעדרות",
    condition: "נדרש אישור לחופשה",
    points: 10,
    direction: "מעלה סיכון",
    note: "מבדיל בין תיאום מסחרי לבין כפיפות.",
    evaluate: (f) => f["answer.FR-12"] === "כן",
  },
  {
    questionId: "FR-13",
    indication: "ליבת העסק",
    condition: "שכירים מבצעים עבודה דומה",
    points: 10,
    direction: "מעלה סיכון",
    note: "אינדיקציה להשתלבות במפעל העסק.",
    evaluate: (f) => f["answer.FR-13"] === "כן",
  },
  {
    questionId: "FR-14",
    indication: "היסטוריית קשר",
    condition: "היה/הפך לשכיר",
    points: 10,
    direction: "מעלה סיכון",
    note: "דורש בחינת שינוי אמיתי במתכונת.",
    evaluate: (f) => f["answer.FR-14"] === "כן",
  },
  {
    questionId: "FR-03",
    indication: "אופן תשלום",
    condition: "חודשי קבוע או לפי שעות",
    points: 5,
    direction: "מעלה במעט",
    note: "לא מכריע כשלעצמו.",
    evaluate: (f) => {
      const value = f["answer.FR-03"];
      return Array.isArray(value) && (value.includes("סכום חודשי קבוע") || value.includes("לפי שעות"));
    },
  },
  {
    questionId: "FR-06",
    indication: "יכולת החלפה",
    condition: "יכול להעסיק אחרים ללא אישור",
    points: -10,
    direction: "מפחית סיכון",
    note: "אינדיקציה לעצמאות עסקית.",
    evaluate: (f) => f["answer.FR-06"] === "יכול להיעזר באחרים",
  },
  {
    questionId: "FR-04",
    indication: "לקוחות נוספים",
    condition: "יש לקוחות נוספים",
    points: -5,
    direction: "מפחית סיכון",
    note: "משקל מוגבל; ייתכן עובד עם עבודה נוספת.",
    evaluate: (f) => f["answer.FR-04"] === "כן",
  },
];

export function computeFreelancerScreening(facts: FactMap): FreelancerScreeningResult {
  const indicators: ScreeningIndicatorResult[] = SCREENING_MODEL.map(({ evaluate, ...indicator }) => ({
    ...indicator,
    contributed: evaluate(facts),
  }));

  const totalPoints = indicators
    .filter((i) => i.contributed)
    .reduce((sum, i) => sum + i.points, 0);

  return { totalPoints, indicators, disclosure: FREELANCER_SCREENING_DISCLOSURE };
}
