import type { FactSourceType } from "@/lib/db/types";

/**
 * The canonical fact layer between raw client data and rule evaluation
 * (PHASE_3_PLAN.md §3). Every fact — whatever produced it — carries the
 * same provenance shape, matching the existing `derived_facts` table
 * (Phase 1 schema) plus the questionnaire-answer source this module adds
 * at read time (see fromAnswers.ts for why answer-facts are not
 * persisted as `derived_facts` rows).
 */
export interface FactRecord {
  factKey: string;
  valueJson: unknown;
  sourceType: FactSourceType;
  sourceId: string | null;
  /** 1-4, spec §12's confidence scale. Never used to increase risk. */
  confidence: number | null;
  createdAt: string;
}

/** factKey -> value, the shape the Rule Engine and cross-check engine actually evaluate against. */
export type FactMap = Readonly<Record<string, unknown>>;

/** Full provenance list plus the flat evaluation map derived from it. */
export interface FactBundle {
  facts: readonly FactRecord[];
  map: FactMap;
}

export function toFactMap(facts: readonly FactRecord[]): FactMap {
  const map: Record<string, unknown> = {};
  for (const fact of facts) map[fact.factKey] = fact.valueJson;
  return map;
}
