import "server-only";
import generated from "@/data/generated/questionnaire.json";
import type { QuestionnaireItem } from "@/domain/questionnaire/types";

export interface QuestionnaireSection {
  domain: string;
  items: QuestionnaireItem[];
}

/**
 * The generated snapshot (see scripts/import-csv.ts) is loaded once per
 * server process, not re-parsed from CSV per request.
 */
export function loadQuestionnaire(): QuestionnaireItem[] {
  return generated as unknown as QuestionnaireItem[];
}

/** Groups questions by their "תחום" (domain) column, preserving CSV row order. */
export function groupByDomain(items: readonly QuestionnaireItem[]): QuestionnaireSection[] {
  const order: string[] = [];
  const byDomain = new Map<string, QuestionnaireItem[]>();

  for (const item of items) {
    if (!byDomain.has(item.domain)) {
      byDomain.set(item.domain, []);
      order.push(item.domain);
    }
    byDomain.get(item.domain)!.push(item);
  }

  return order.map((domain) => ({ domain, items: byDomain.get(domain)! }));
}
