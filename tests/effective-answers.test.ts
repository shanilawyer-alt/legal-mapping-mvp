import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCondition } from "@/domain/branching/parser";
import { evaluateCondition } from "@/domain/branching/evaluate";
import { parseCsv } from "@/domain/csv/parse";
import { questionnaireRowSchema } from "@/domain/csv/schemas";
import { normalizeQuestionnaireRow } from "@/domain/questionnaire/normalize";
import { computeEffectiveAnswers } from "@/domain/questionnaire/effective";
import type { AnswerValue } from "@/domain/branching/evaluate";
import type { QuestionnaireItem } from "@/domain/questionnaire/types";

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
    documentTypeId: null,
    internalCheck: "",
    possibleService: "",
    isCore: false,
    ...partial,
  };
}

describe("computeEffectiveAnswers", () => {
  it("keeps a core (always-visible) answer as effective", () => {
    const items = [item({ id: "Q1", isCore: true })];
    const { effectiveAnswers, staleQuestionIds, statuses } = computeEffectiveAnswers(items, {
      Q1: "hello",
    });
    expect(effectiveAnswers).toEqual({ Q1: "hello" });
    expect(staleQuestionIds).toEqual([]);
    expect(statuses).toEqual([{ questionId: "Q1", active: true, hasAnswer: true, stale: false }]);
  });

  it("excludes an answer whose question is currently hidden", () => {
    const items = [
      item({ id: "Q-01" }),
      item({ id: "Q-02", triggerCondition: parseCondition("Q-01 = כן") }),
    ];
    const { effectiveAnswers, staleQuestionIds } = computeEffectiveAnswers(items, {
      "Q-01": "לא",
      "Q-02": "some answer entered while Q-01 was previously כן",
    });
    expect(effectiveAnswers).toEqual({ "Q-01": "לא" });
    expect(staleQuestionIds).toEqual(["Q-02"]);
  });

  it("marks a whole downstream branch stale when the gating answer changes, even though the raw answer is still present", () => {
    const items = [
      item({ id: "Q-01" }), // GEN-04 equivalent
      item({ id: "Q-02", triggerCondition: parseCondition("Q-01 = כן") }),
      item({ id: "Q-03", triggerCondition: parseCondition("Q-02 = כן") }),
    ];
    // Q-01 flipped to לא after Q-02 and Q-03 were both answered כן.
    const { effectiveAnswers, staleQuestionIds } = computeEffectiveAnswers(items, {
      "Q-01": "לא",
      "Q-02": "כן",
      "Q-03": "כן",
    });
    expect(effectiveAnswers).toEqual({ "Q-01": "לא" });
    // Q-03's raw answer is still "כן" (which would satisfy Q-02 = כן if
    // evaluated against the raw map), but Q-02 itself is stale, so Q-03
    // must not be resurrected by evaluating against unfiltered raw answers.
    expect([...staleQuestionIds].sort()).toEqual(["Q-02", "Q-03"]);
  });

  it("re-admits a downstream answer once its gating answer is restored", () => {
    const items = [
      item({ id: "Q-01" }),
      item({ id: "Q-02", triggerCondition: parseCondition("Q-01 = כן") }),
    ];
    const { effectiveAnswers, staleQuestionIds } = computeEffectiveAnswers(items, {
      "Q-01": "כן",
      "Q-02": "answer",
    });
    expect(effectiveAnswers).toEqual({ "Q-01": "כן", "Q-02": "answer" });
    expect(staleQuestionIds).toEqual([]);
  });

  it("reports unanswered questions as inactive-without-answer, not stale", () => {
    const items = [item({ id: "Q-01", triggerCondition: parseCondition("Q-00 = כן") })];
    const { statuses, staleQuestionIds } = computeEffectiveAnswers(items, {});
    expect(statuses).toEqual([
      { questionId: "Q-01", active: false, hasAnswer: false, stale: false },
    ]);
    expect(staleQuestionIds).toEqual([]);
  });

  it("treats null/undefined stored values as no answer", () => {
    const items = [item({ id: "Q-01", isCore: true })];
    expect(computeEffectiveAnswers(items, { "Q-01": null }).effectiveAnswers).toEqual({});
    expect(computeEffectiveAnswers(items, { "Q-01": undefined }).effectiveAnswers).toEqual({});
  });
});

describe("computeEffectiveAnswers against the real questionnaire.csv", () => {
  const csvText = readFileSync(join(__dirname, "..", "data", "questionnaire.csv"), "utf-8");
  const { rows } = parseCsv(csvText, questionnaireRowSchema);
  const items = rows.map(normalizeQuestionnaireRow);

  it("confirms every trigger references only an earlier question ID (the forward-pass invariant this policy relies on)", () => {
    const idIndex = new Map(items.map((it, i) => [it.id, i]));
    const collectIds = (node: (typeof items)[number]["triggerCondition"], out: string[]) => {
      if (node.type === "clause") out.push(node.questionId);
      if (node.type === "or") node.clauses.forEach((c) => collectIds(c, out));
    };
    items.forEach((it, i) => {
      const refs: string[] = [];
      collectIds(it.triggerCondition, refs);
      for (const refId of refs) {
        expect(idIndex.has(refId)).toBe(true);
        expect(idIndex.get(refId)!).toBeLessThan(i);
      }
    });
  });

  it("produces an effective answer set consistent with directly evaluating each trigger against it", () => {
    // Answer every core question with something plausibly truthy, leave
    // conditional ones unanswered — a realistic partial submission.
    const raw: Record<string, AnswerValue> = {};
    for (const it of items) {
      if (it.isCore) raw[it.id] = it.answerType === "number" ? 1 : "כן";
    }
    const { effectiveAnswers } = computeEffectiveAnswers(items, raw);
    for (const it of items) {
      if (it.id in effectiveAnswers) {
        expect(evaluateCondition(it.triggerCondition, effectiveAnswers)).toBe(true);
      }
    }
  });
});
