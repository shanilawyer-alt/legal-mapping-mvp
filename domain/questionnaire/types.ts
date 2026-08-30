import type { ConditionNode } from "@/domain/branching/types";

export type AnswerType =
  | "single_choice" // בחירה יחידה
  | "multi_choice" // בחירה מרובה
  | "short_text" // טקסט קצר
  | "number" // מספר
  | "hours" // מספר שעות
  | "yes_no" // כן/לא
  | "yes_no_unknown"; // כן/לא/לא יודעת

const ANSWER_TYPE_MAP: Record<string, AnswerType> = {
  "בחירה יחידה": "single_choice",
  "בחירה מרובה": "multi_choice",
  "טקסט קצר": "short_text",
  "מספר": "number",
  "מספר שעות": "hours",
  "כן/לא": "yes_no",
  "כן/לא/לא יודעת": "yes_no_unknown",
};

export function mapAnswerType(hebrewLabel: string): AnswerType | null {
  return ANSWER_TYPE_MAP[hebrewLabel] ?? null;
}

export interface QuestionnaireItem {
  readonly id: string;
  readonly domain: string;
  readonly subDomain: string;
  readonly clientText: string;
  readonly answerType: AnswerType;
  readonly options: readonly string[] | null;
  readonly triggerRaw: string;
  readonly triggerCondition: ConditionNode;
  readonly followUp: string;
  readonly documentRequest: string;
  readonly internalCheck: string;
  readonly possibleService: string;
  readonly isCore: boolean;
}

const OPTIONS_SPLIT = /\s*\|\s*/u;

export function parseOptions(raw: string): readonly string[] | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return trimmed.split(OPTIONS_SPLIT).filter((v) => v.length > 0);
}
