import type { RuleCatalogRow } from "@/domain/csv/schemas";
import type { RuleDefinition } from "@/domain/rules/types";

/**
 * Cross-checks the hand-translated `RULE_CATALOG` against the real
 * `rule_catalog.csv` data at test/startup time (PHASE_3_PLAN.md §4) —
 * the same discipline as Phase 1's questionnaire-trigger grammar check.
 * Never silently drifts: a Rule ID, severity, or critical-override flag
 * that stops matching the CSV is a hard validation failure, not a
 * warning.
 */
export interface CatalogValidationIssue {
  ruleId: string;
  problem: string;
}

export function validateRuleCatalog(
  catalog: readonly RuleDefinition[],
  csvRows: readonly RuleCatalogRow[],
): CatalogValidationIssue[] {
  const issues: CatalogValidationIssue[] = [];
  const csvById = new Map(csvRows.map((row) => [row["Rule ID"], row]));
  const catalogIds = new Set(catalog.map((r) => r.ruleId));

  for (const row of csvRows) {
    if (!catalogIds.has(row["Rule ID"])) {
      issues.push({ ruleId: row["Rule ID"], problem: "present in rule_catalog.csv but missing from RULE_CATALOG" });
    }
  }

  for (const rule of catalog) {
    const row = csvById.get(rule.ruleId);
    if (!row) {
      issues.push({ ruleId: rule.ruleId, problem: "present in RULE_CATALOG but not in rule_catalog.csv" });
      continue;
    }

    const csvSeverity = Number(row["חומרה בסיסית 1-5"]);
    if (csvSeverity !== rule.baseSeverity) {
      issues.push({
        ruleId: rule.ruleId,
        problem: `baseSeverity ${rule.baseSeverity} does not match CSV's ${csvSeverity}`,
      });
    }

    const csvCritical = row["Override קריטי?"].trim() === "כן";
    if (csvCritical !== rule.criticalOverride) {
      issues.push({
        ruleId: rule.ruleId,
        problem: `criticalOverride ${rule.criticalOverride} does not match CSV's ${csvCritical}`,
      });
    }

    const csvAutomation = row["אוטומציה"].trim();
    if (csvAutomation !== rule.automationLevel) {
      issues.push({
        ruleId: rule.ruleId,
        problem: `automationLevel "${rule.automationLevel}" does not match CSV's "${csvAutomation}"`,
      });
    }

    const csvCondition = row["תנאי לוגי V1"].trim();
    if (csvCondition !== rule.conditionRaw.trim()) {
      issues.push({
        ruleId: rule.ruleId,
        problem: `conditionRaw does not match CSV's "תנאי לוגי V1" verbatim`,
      });
    }
  }

  if (catalog.length !== csvRows.length) {
    issues.push({
      ruleId: "*",
      problem: `RULE_CATALOG has ${catalog.length} entries but rule_catalog.csv has ${csvRows.length} rows`,
    });
  }

  return issues;
}
