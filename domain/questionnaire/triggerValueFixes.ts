import type { Clause, ConditionNode } from "@/domain/branching/types";
import type { QuestionnaireItem } from "@/domain/questionnaire/types";

/**
 * OPEN_QUESTIONS.md item 30 (resolved during pilot validation): six
 * `questionnaire.csv` trigger clauses use a short-form value that does
 * not exactly equal any of the referenced question's real options —
 * found by programmatically cross-referencing every trigger clause's
 * values against its target question's own option list (zero such
 * mismatches existed anywhere else in the 103-question set).
 * `questionnaire.csv` itself is never edited here — its wording and IDs
 * are the approved V1 source data — so this module corrects only the
 * *compiled* trigger AST, at import time. `domain/branching/evaluate.ts`'s
 * plain exact-match semantics, which correctly serve the other ~97
 * triggers, are also left completely unchanged; only these six known,
 * hand-verified clauses are touched. Every resolution below maps a
 * short token to the literal real option string(s) it unambiguously
 * abbreviates — nothing here invents new branching logic or wording,
 * the same discipline already applied to `rule_catalog.csv`'s
 * abbreviated conditions (domain/rules/catalog.ts).
 *
 * Keyed by the *owning* question (the one whose visibility the trigger
 * controls) — e.g. `"TIME-07"`, not `"TIME-06"` (the question it reads
 * from) — since that is the unique identifier for "this item's own
 * trigger condition."
 */
export const TRIGGER_VALUE_FIXES: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  // TIME-01 options: "כן, כולם" | "רק עובדים שעתיים" | "רק חלק מהעובדים" | "לא" | "לא יודעת"
  "TIME-02": {
    // Raw trigger: "TIME-01 = כן/חלק". TIME-02 asks *how* time is
    // reported, so it applies once reporting happens for everyone, or
    // partially.
    "כן": ["כן, כולם"],
    "חלק": ["רק חלק מהעובדים"],
  },
  "TIME-03": {
    // Raw trigger: "TIME-01 = רק חלק / רק שעתיים / לא". TIME-03 asks
    // which employees *don't* report and why, so it applies to every
    // less-than-universal/no-reporting answer. Its third token, "לא",
    // already equals TIME-01's own "לא" option exactly and needs no
    // entry here.
    "רק חלק": ["רק חלק מהעובדים"],
    "רק שעתיים": ["רק עובדים שעתיים"],
  },
  // TIME-06 options: "כן, באופן קבוע" | "כן, לעיתים" | "לא" | "לא יודעת"
  "TIME-07": {
    // Raw trigger: "TIME-06 = כן/לעיתים" — two explicit tokens naming
    // the two real "yes" variants: "לעיתים" unambiguously names "כן,
    // לעיתים" (the only option containing that word), so by
    // elimination the bare "כן" token names the other "yes" option,
    // "כן, באופן קבוע".
    "כן": ["כן, באופן קבוע"],
    "לעיתים": ["כן, לעיתים"],
  },
  "TIME-09": {
    // Same target question and identical raw trigger text as TIME-07.
    "כן": ["כן, באופן קבוע"],
    "לעיתים": ["כן, לעיתים"],
  },
  // TIME-07 options: "לפי שעות שבוצעו בפועל" | "רכיב שעות נוספות גלובלי" | "כלולות בשכר החודשי" | "לא משולמות בנפרד" | "אחר" | "לא יודעת"
  "TIME-08": {
    // Raw trigger: "TIME-07 כולל שעות נוספות גלובליות" — the only
    // TIME-07 option naming a global overtime component.
    "שעות נוספות גלובליות": ["רכיב שעות נוספות גלובלי"],
  },
  // SOC-07 options: "כן, לכל העובדים" | "כן, לחלק מהעובדים" | "לא" | "לא יודעת"
  "SOC-08": {
    // Raw trigger: "SOC-07 = כן" — a single bare token with no
    // companion token to narrow it (unlike TIME-07/09's paired
    // "כן"/"לעיתים"). SOC-08 asks about eligibility *conditions*,
    // relevant whether eligibility is company-wide or partial, so
    // "כן" expands to both real "yes" variants.
    "כן": ["כן, לכל העובדים", "כן, לחלק מהעובדים"],
  },
};

function fixClauseValues(clause: Clause, fixes: Readonly<Record<string, readonly string[]>>): Clause {
  const fixedValues: string[] = [];
  for (const value of clause.values) {
    const replacement = fixes[value];
    if (replacement) fixedValues.push(...replacement);
    else fixedValues.push(value);
  }
  return { ...clause, values: fixedValues };
}

function fixConditionNode(
  node: ConditionNode,
  fixes: Readonly<Record<string, readonly string[]>>,
): ConditionNode {
  if (node.type === "clause") return fixClauseValues(node, fixes);
  if (node.type === "or") return { ...node, clauses: node.clauses.map((c) => fixConditionNode(c, fixes)) };
  return node;
}

/**
 * Applies `TRIGGER_VALUE_FIXES` to every questionnaire item's compiled
 * `triggerCondition`. Pure — returns a new array, never mutates its
 * input, and leaves every item without an entry above completely
 * untouched (byte-for-byte, in fact, since only the six named items
 * are re-spread at all).
 */
export function applyTriggerValueFixes(items: readonly QuestionnaireItem[]): QuestionnaireItem[] {
  return items.map((item) => {
    const fixes = TRIGGER_VALUE_FIXES[item.id];
    if (!fixes) return item;
    return { ...item, triggerCondition: fixConditionNode(item.triggerCondition, fixes) };
  });
}

export interface TriggerValueMismatch {
  ownerQuestionId: string;
  targetQuestionId: string;
  badValue: string;
  realOptions: readonly string[];
}

/**
 * Cross-checks every trigger clause's values against its target
 * question's real option list. Used to prove `TRIGGER_VALUE_FIXES`
 * resolves every mismatch that exists today, and to catch any new one
 * a future `questionnaire.csv` change might introduce (run against
 * `applyTriggerValueFixes`'s *output* — if this ever returns a
 * non-empty array for the fixed set, the fix table needs updating).
 */
export function findTriggerValueMismatches(items: readonly QuestionnaireItem[]): TriggerValueMismatch[] {
  const byId = new Map(items.map((i) => [i.id, i]));
  const mismatches: TriggerValueMismatch[] = [];

  function checkNode(ownerQuestionId: string, node: ConditionNode) {
    if (node.type === "clause") {
      if (node.operator === ">") return; // numeric threshold, not option text
      const options = byId.get(node.questionId)?.options ?? [];
      for (const value of node.values) {
        if (!options.includes(value)) {
          mismatches.push({
            ownerQuestionId,
            targetQuestionId: node.questionId,
            badValue: value,
            realOptions: options,
          });
        }
      }
    } else if (node.type === "or") {
      node.clauses.forEach((c) => checkNode(ownerQuestionId, c));
    }
  }

  for (const item of items) checkNode(item.id, item.triggerCondition);
  return mismatches;
}
