import { describe, expect, it } from "vitest";
import { deriveFactsFromAnswers } from "@/domain/facts/fromAnswers";
import { buildFactBundle } from "@/domain/facts/bundle";
import type { Answer, DerivedFact } from "@/lib/db/types";
import type { QuestionnaireItem } from "@/domain/questionnaire/types";
import { parseCondition } from "@/domain/branching/parser";

function item(partial: Partial<QuestionnaireItem> & Pick<QuestionnaireItem, "id">): QuestionnaireItem {
  return {
    domain: "test",
    subDomain: "test",
    clientText: partial.id,
    answerType: "short_text",
    options: null,
    triggerRaw: "תמיד",
    triggerCondition: { type: "always" },
    followUp: "",
    documentRequest: "",
    internalCheck: "",
    possibleService: "",
    isCore: false,
    ...partial,
  };
}

function answer(partial: Partial<Answer> & Pick<Answer, "questionId" | "valueJson">): Answer {
  return {
    id: `answer-${partial.questionId}`,
    assessmentId: "assessment-1",
    source: "client",
    answeredAt: "2026-01-01T00:00:00.000Z",
    ...partial,
  };
}

describe("deriveFactsFromAnswers", () => {
  it("produces one fact per effective answer, namespaced answer.<QUESTION_ID>", () => {
    const items = [item({ id: "Q-01" })];
    const answers = [answer({ questionId: "Q-01", valueJson: "כן" })];
    const facts = deriveFactsFromAnswers(answers, items);
    expect(facts).toEqual([
      {
        factKey: "answer.Q-01",
        valueJson: "כן",
        sourceType: "answer",
        sourceId: "answer-Q-01",
        confidence: 1,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ]);
  });

  it("always assigns confidence 1 (self-report only, spec §12) regardless of value", () => {
    const items = [item({ id: "Q-01" })];
    const facts = deriveFactsFromAnswers([answer({ questionId: "Q-01", valueJson: 42 })], items);
    expect(facts[0].confidence).toBe(1);
  });

  it("excludes a stale answer whose gating question has changed (branching interaction)", () => {
    const items = [
      item({ id: "Q-01" }),
      item({ id: "Q-02", triggerCondition: parseCondition("Q-01 = כן") }),
    ];
    // Q-01 flipped to "לא" after Q-02 was answered "כן" — Q-02's answer is
    // now stale per computeEffectiveAnswers (OPEN_QUESTIONS item 18).
    const answers = [
      answer({ questionId: "Q-01", valueJson: "לא" }),
      answer({ questionId: "Q-02", valueJson: "כן" }),
    ];
    const facts = deriveFactsFromAnswers(answers, items);
    expect(facts.map((f) => f.factKey)).toEqual(["answer.Q-01"]);
  });

  it("skips a null/cleared answer entirely", () => {
    const items = [item({ id: "Q-01" })];
    const facts = deriveFactsFromAnswers([answer({ questionId: "Q-01", valueJson: null })], items);
    expect(facts).toEqual([]);
  });

  it("produces no facts when there are no answers", () => {
    expect(deriveFactsFromAnswers([], [item({ id: "Q-01" })])).toEqual([]);
  });
});

describe("buildFactBundle", () => {
  const items = [item({ id: "Q-01" })];
  const answers = [answer({ questionId: "Q-01", valueJson: "כן" })];

  it("merges answer facts and persisted derived_facts into one map", () => {
    const storedFacts: DerivedFact[] = [
      {
        id: "fact-1",
        assessmentId: "assessment-1",
        factKey: "contract.overtime.type",
        valueJson: "global",
        sourceType: "document_extraction",
        sourceId: "extraction-1",
        confidence: 3,
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ];
    const bundle = buildFactBundle({ answers, items, storedFacts });
    expect(bundle.map).toEqual({ "answer.Q-01": "כן", "contract.overtime.type": "global" });
    expect(bundle.facts).toHaveLength(2);
  });

  it("a persisted fact takes precedence over an answer fact sharing the same key", () => {
    const storedFacts: DerivedFact[] = [
      {
        id: "fact-1",
        assessmentId: "assessment-1",
        factKey: "answer.Q-01",
        valueJson: "overridden-by-cross-check",
        sourceType: "cross_check",
        sourceId: null,
        confidence: 3,
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ];
    const bundle = buildFactBundle({ answers, items, storedFacts });
    expect(bundle.map["answer.Q-01"]).toBe("overridden-by-cross-check");
    expect(bundle.facts).toHaveLength(1);
  });

  it("returns an empty bundle when there are no answers or stored facts", () => {
    const bundle = buildFactBundle({ answers: [], items, storedFacts: [] });
    expect(bundle.facts).toEqual([]);
    expect(bundle.map).toEqual({});
  });
});
