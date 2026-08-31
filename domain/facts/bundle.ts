import type { Answer, DerivedFact } from "@/lib/db/types";
import type { QuestionnaireItem } from "@/domain/questionnaire/types";
import { deriveFactsFromAnswers } from "@/domain/facts/fromAnswers";
import { toFactMap, type FactBundle, type FactRecord } from "@/domain/facts/types";

function toRecord(fact: DerivedFact): FactRecord {
  return {
    factKey: fact.factKey,
    valueJson: fact.valueJson,
    sourceType: fact.sourceType,
    sourceId: fact.sourceId,
    confidence: fact.confidence,
    createdAt: fact.createdAt,
  };
}

/**
 * Combines answer-derived facts (computed live, never persisted — see
 * fromAnswers.ts) with persisted `derived_facts` rows (document
 * extraction, cross-check, system-derived) into the single fact bundle
 * the Rule Engine and cross-check engine read from. If a document-
 * extraction/cross-check fact and an answer fact ever share a factKey
 * (they shouldn't — the `answer.` prefix is reserved), the persisted
 * fact wins, since it represents a later, more corroborated pipeline
 * stage than a bare self-reported answer.
 */
export function buildFactBundle(params: {
  answers: readonly Answer[];
  items: readonly QuestionnaireItem[];
  storedFacts: readonly DerivedFact[];
}): FactBundle {
  const answerFacts = deriveFactsFromAnswers(params.answers, params.items);
  const storedRecords = params.storedFacts.map(toRecord);

  const byKey = new Map<string, FactRecord>();
  for (const fact of answerFacts) byKey.set(fact.factKey, fact);
  for (const fact of storedRecords) byKey.set(fact.factKey, fact);

  const facts = [...byKey.values()];
  return { facts, map: toFactMap(facts) };
}
