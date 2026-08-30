/**
 * Typed AST for questionnaire trigger conditions (MASTER_BUILD_SPEC.md §6),
 * e.g. "GEN-04 > 0", "PRIV-08 = כן", "GEN-05 > 0 או GEN-04 > 0".
 *
 * This is intentionally the same grammar the Rule Engine (Phase 3) will
 * need for `rule_catalog.csv` conditions, minus the English AND/OR
 * combinators rule conditions use instead of Hebrew "או" — see
 * IMPLEMENTATION_PLAN.md §5. Nothing here evaluates rules yet.
 */

export type ComparisonOperator = "=" | "≠" | ">" | "כולל";

export interface Clause {
  readonly type: "clause";
  readonly questionId: string;
  readonly operator: ComparisonOperator;
  /** For "=" / "≠" / "כולל": one or more acceptable option values (OR semantics within the list). For ">": exactly one numeric threshold. */
  readonly values: readonly string[];
}

export interface OrNode {
  readonly type: "or";
  readonly clauses: readonly ConditionNode[];
}

export interface AlwaysNode {
  readonly type: "always";
}

export type ConditionNode = Clause | OrNode | AlwaysNode;

/** A trigger string that could not be parsed under the supported grammar. */
export class UnparseableConditionError extends Error {
  constructor(
    public readonly raw: string,
    reason: string,
  ) {
    super(`Cannot parse branching condition "${raw}": ${reason}`);
    this.name = "UnparseableConditionError";
  }
}
