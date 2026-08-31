import type { FactMap } from "@/domain/facts/types";

/**
 * Verbatim values from `rule_catalog.csv`'s "אוטומציה" column — the
 * CSV's own signal for which rules the engine may auto-decide (see
 * OPEN_QUESTIONS.md item 21). Hebrew values are kept as-is (not
 * translated to English) for the same reason the CSV schemas keep
 * Hebrew headers verbatim: a mismatch fails loudly instead of silently
 * drifting from the source.
 */
export type AutomationLevel = "אוטומטי" | "AI+Rule" | "Rule+Manual" | "אוטומטי+Manual" | "AI" | "Manual";

/**
 * One rule, hand-translated from a `rule_catalog.csv` row into a typed
 * predicate (PHASE_3_PLAN.md §1/§4, OPEN_QUESTIONS.md item 21) — every
 * field below corresponds to one CSV column, named in a comment on each
 * catalog entry. `evaluate` returns `true` only when the rule's own
 * condition is both decidable from canonical facts AND satisfied; a rule
 * whose condition cannot be reduced to a decidable predicate at all
 * (see catalog.ts's per-rule comments) always returns `false` here,
 * never guessed — `automationLevel` still records the CSV's own
 * classification for the attorney workspace to display.
 */
export interface RuleDefinition {
  ruleId: string; // "Rule ID"
  domainArea: string; // "תחום"
  topic: string; // "ממצא/נושא" — also the finding's internal title
  inputs: readonly string[]; // "קלטים" — question IDs / fact keys this rule reads
  conditionRaw: string; // "תנאי לוגי V1" — kept verbatim for the attorney workspace
  automationLevel: AutomationLevel;
  baseSeverity: number; // "חומרה בסיסית 1-5"
  criticalOverride: boolean; // "Override קריטי?"
  recommendation: string; // "המלצה ראשונית" — copied verbatim into findings
  possibleService: string; // "שירות אפשרי"
  legalSourceUrl: string | null; // "מקור משפטי"
  cautionNote: string; // "הערת זהירות"
  /**
   * Set only on a rule whose condition is `Manual`-tagged or has no
   * decidable predicate at all (`evaluate` is hardcoded `() => false`) —
   * see OPEN_QUESTIONS.md item 21. Distinguishes "this engine has
   * evaluated the condition and it did not hold" from "this rule can
   * never be auto-decided," which is what actually drives
   * `requiresManualReview` in evaluate.ts.
   */
  alwaysRequiresManualReview?: boolean;
  evaluate: (facts: FactMap) => boolean;
}

export interface RuleEvaluationResult {
  ruleId: string;
  matched: boolean;
  /** True only for a rule this engine can never auto-decide (Manual-tagged, or an undecidable condition) — see OPEN_QUESTIONS.md item 21. */
  requiresManualReview: boolean;
  inputSnapshot: Record<string, unknown>;
  baseSeverity: number;
  criticalOverride: boolean;
}
