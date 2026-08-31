import type { QuestionnaireRow } from "@/domain/csv/schemas";
import { parseCondition } from "@/domain/branching/parser";
import { UnparseableConditionError } from "@/domain/branching/types";
import {
  mapAnswerType,
  parseOptions,
  type QuestionnaireItem,
} from "@/domain/questionnaire/types";

export class UnknownAnswerTypeError extends Error {
  constructor(
    public readonly questionId: string,
    public readonly rawLabel: string,
  ) {
    super(`Question ${questionId} has an unrecognized answer type: "${rawLabel}"`);
    this.name = "UnknownAnswerTypeError";
  }
}

/**
 * Converts one validated questionnaire.csv row into a typed
 * QuestionnaireItem, including parsing its branching trigger into an AST.
 * Throws (rather than silently defaulting) on an unrecognized answer type
 * or an unparseable trigger, so the importer surfaces every such row
 * instead of producing a questionnaire with silently-broken branching.
 */
export function normalizeQuestionnaireRow(row: QuestionnaireRow): QuestionnaireItem {
  const answerType = mapAnswerType(row["סוג תשובה"]);
  if (!answerType) {
    throw new UnknownAnswerTypeError(row.ID, row["סוג תשובה"]);
  }

  const triggerRaw = row["מתי מוצג (Trigger)"].trim() || "תמיד";

  let triggerCondition;
  try {
    triggerCondition = parseCondition(triggerRaw);
  } catch (err) {
    if (err instanceof UnparseableConditionError) {
      throw new UnparseableConditionError(`${row.ID}: ${err.raw}`, err.message);
    }
    throw err;
  }

  return {
    id: row.ID,
    domain: row["תחום"],
    subDomain: row["תת-תחום"],
    clientText: row["נוסח השאלה ללקוח"],
    answerType,
    options: parseOptions(row["אפשרויות / פורמט"]),
    triggerRaw,
    triggerCondition,
    followUp: row["שאלת המשך / פעולה"],
    documentRequest: row["מסמך להעלאה"],
    documentTypeId: null, // resolved by domain/questionnaire/documentTypeMapping.ts at import time
    internalCheck: row["בדיקה פנימית בשלב הניתוח"],
    possibleService: row["שירות/צורך שעשוי להתגלות"],
    isCore: row["ליבה/מותנה"] === "ליבה",
  };
}
