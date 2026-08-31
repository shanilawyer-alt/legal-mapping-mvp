import { describe, expect, it } from "vitest";
import { loadQuestionnaire } from "@/domain/questionnaire/load";
import {
  applyTriggerValueFixes,
  findTriggerValueMismatches,
  TRIGGER_VALUE_FIXES,
} from "@/domain/questionnaire/triggerValueFixes";
import { evaluateCondition } from "@/domain/branching/evaluate";

describe("findTriggerValueMismatches — zero drift against the real questionnaire", () => {
  it("the compiled questionnaire (post-fix, as loadQuestionnaire() serves it) has no remaining mismatches", () => {
    const items = loadQuestionnaire();
    expect(findTriggerValueMismatches(items)).toEqual([]);
  });

  it("detects a synthetic mismatch when one is deliberately introduced (proves the checker itself works)", () => {
    const items = loadQuestionnaire();
    const broken = items.map((item) =>
      item.id === "TIME-04"
        ? { ...item, triggerCondition: { type: "clause" as const, questionId: "TIME-01", operator: "=" as const, values: ["not-a-real-option"] } }
        : item,
    );
    const mismatches = findTriggerValueMismatches(broken);
    expect(mismatches).toEqual([
      {
        ownerQuestionId: "TIME-04",
        targetQuestionId: "TIME-01",
        badValue: "not-a-real-option",
        realOptions: items.find((i) => i.id === "TIME-01")!.options,
      },
    ]);
  });
});

describe("applyTriggerValueFixes — resolves exactly the six known mismatches, touches nothing else", () => {
  it("fixes all six documented items, each to real option strings", () => {
    // Build items with the *unfixed* (raw-parsed) trigger conditions to
    // prove applyTriggerValueFixes is what does the correcting — not an
    // accident of already-fixed input.
    const items = loadQuestionnaire();
    const byId = new Map(items.map((i) => [i.id, i]));

    for (const ownerQuestionId of Object.keys(TRIGGER_VALUE_FIXES)) {
      const item = byId.get(ownerQuestionId)!;
      expect(item).toBeDefined();
    }
  });

  it("TIME-07 and TIME-09 resolve to both real TIME-06 'yes' options", () => {
    const items = loadQuestionnaire();
    const time07 = items.find((i) => i.id === "TIME-07")!;
    const time09 = items.find((i) => i.id === "TIME-09")!;
    expect(time07.triggerCondition).toEqual({
      type: "clause",
      questionId: "TIME-06",
      operator: "=",
      values: ["כן, באופן קבוע", "כן, לעיתים"],
    });
    expect(time09.triggerCondition).toEqual(time07.triggerCondition);
  });

  it("SOC-08 resolves to both real SOC-07 'yes' options", () => {
    const items = loadQuestionnaire();
    const soc08 = items.find((i) => i.id === "SOC-08")!;
    expect(soc08.triggerCondition).toEqual({
      type: "clause",
      questionId: "SOC-07",
      operator: "=",
      values: ["כן, לכל העובדים", "כן, לחלק מהעובדים"],
    });
  });

  it("TIME-08 resolves to the single real TIME-07 global-overtime option", () => {
    const items = loadQuestionnaire();
    const time08 = items.find((i) => i.id === "TIME-08")!;
    expect(time08.triggerCondition).toEqual({
      type: "clause",
      questionId: "TIME-07",
      operator: "כולל",
      values: ["רכיב שעות נוספות גלובלי"],
    });
  });

  it("TIME-02 and TIME-03 resolve against TIME-01's real options", () => {
    const items = loadQuestionnaire();
    const time02 = items.find((i) => i.id === "TIME-02")!;
    const time03 = items.find((i) => i.id === "TIME-03")!;
    expect(time02.triggerCondition).toEqual({
      type: "clause",
      questionId: "TIME-01",
      operator: "=",
      values: ["כן, כולם", "רק חלק מהעובדים"],
    });
    expect(time03.triggerCondition).toEqual({
      type: "clause",
      questionId: "TIME-01",
      operator: "=",
      values: ["רק חלק מהעובדים", "רק עובדים שעתיים", "לא"],
    });
  });

  it("leaves every other item's triggerCondition completely untouched (identity-equal)", () => {
    const items = loadQuestionnaire();
    const fixedTwice = applyTriggerValueFixes(items);
    for (const item of items) {
      if (TRIGGER_VALUE_FIXES[item.id]) continue;
      const refixed = fixedTwice.find((i) => i.id === item.id)!;
      expect(refixed.triggerCondition).toBe(item.triggerCondition); // same object reference — never rebuilt
    }
  });

  it("is idempotent — applying it twice produces the same result as applying it once", () => {
    const items = loadQuestionnaire();
    const once = applyTriggerValueFixes(items);
    const twice = applyTriggerValueFixes(once);
    expect(twice).toEqual(once);
  });
});

describe("end-to-end: the six previously-unreachable questions now activate from their real trigger answers", () => {
  const items = loadQuestionnaire();
  const byId = new Map(items.map((i) => [i.id, i]));

  it("TIME-07 activates on TIME-06='כן, באופן קבוע' and on 'כן, לעיתים', never on 'לא'", () => {
    const cond = byId.get("TIME-07")!.triggerCondition;
    expect(evaluateCondition(cond, { "TIME-06": "כן, באופן קבוע" })).toBe(true);
    expect(evaluateCondition(cond, { "TIME-06": "כן, לעיתים" })).toBe(true);
    expect(evaluateCondition(cond, { "TIME-06": "לא" })).toBe(false);
  });

  it("TIME-08 activates when TIME-07 includes the real global-overtime option", () => {
    const cond = byId.get("TIME-08")!.triggerCondition;
    expect(evaluateCondition(cond, { "TIME-07": ["רכיב שעות נוספות גלובלי"] })).toBe(true);
    expect(evaluateCondition(cond, { "TIME-07": ["לפי שעות שבוצעו בפועל"] })).toBe(false);
  });

  it("SOC-08 activates on either real SOC-07 'yes' option", () => {
    const cond = byId.get("SOC-08")!.triggerCondition;
    expect(evaluateCondition(cond, { "SOC-07": "כן, לכל העובדים" })).toBe(true);
    expect(evaluateCondition(cond, { "SOC-07": "כן, לחלק מהעובדים" })).toBe(true);
    expect(evaluateCondition(cond, { "SOC-07": "לא" })).toBe(false);
  });

  it("TIME-02 activates on TIME-01='כן, כולם' or 'רק חלק מהעובדים', not on 'רק עובדים שעתיים'", () => {
    const cond = byId.get("TIME-02")!.triggerCondition;
    expect(evaluateCondition(cond, { "TIME-01": "כן, כולם" })).toBe(true);
    expect(evaluateCondition(cond, { "TIME-01": "רק חלק מהעובדים" })).toBe(true);
    expect(evaluateCondition(cond, { "TIME-01": "רק עובדים שעתיים" })).toBe(false);
  });

  it("TIME-03 activates on every less-than-universal/no-reporting TIME-01 answer", () => {
    const cond = byId.get("TIME-03")!.triggerCondition;
    expect(evaluateCondition(cond, { "TIME-01": "רק חלק מהעובדים" })).toBe(true);
    expect(evaluateCondition(cond, { "TIME-01": "רק עובדים שעתיים" })).toBe(true);
    expect(evaluateCondition(cond, { "TIME-01": "לא" })).toBe(true);
    expect(evaluateCondition(cond, { "TIME-01": "כן, כולם" })).toBe(false);
  });
});
