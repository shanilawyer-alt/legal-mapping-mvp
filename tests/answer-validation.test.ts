import { describe, expect, it } from "vitest";
import { normalizeAnswerValue, validateAnswerValue } from "@/domain/questionnaire/validate";
import type { QuestionnaireItem } from "@/domain/questionnaire/types";

function item(partial: Partial<QuestionnaireItem> & Pick<QuestionnaireItem, "answerType">): QuestionnaireItem {
  return {
    id: "Q-01",
    domain: "test",
    subDomain: "test",
    clientText: "test",
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

describe("validateAnswerValue", () => {
  it("always accepts null/undefined regardless of answer type", () => {
    for (const answerType of [
      "short_text",
      "number",
      "hours",
      "yes_no",
      "yes_no_unknown",
      "single_choice",
      "multi_choice",
    ] as const) {
      expect(validateAnswerValue(item({ answerType }), null)).toEqual({ ok: true });
      expect(validateAnswerValue(item({ answerType }), undefined)).toEqual({ ok: true });
    }
  });

  describe("short_text", () => {
    it("accepts a string", () => {
      expect(validateAnswerValue(item({ answerType: "short_text" }), "hello")).toEqual({
        ok: true,
      });
    });
    it("rejects a non-string", () => {
      expect(validateAnswerValue(item({ answerType: "short_text" }), 5)).toEqual({
        ok: false,
        error: "invalid_type",
      });
    });
  });

  describe("number / hours", () => {
    it("accepts a non-negative finite number", () => {
      expect(validateAnswerValue(item({ answerType: "number" }), 0)).toEqual({ ok: true });
      expect(validateAnswerValue(item({ answerType: "hours" }), 7.5)).toEqual({ ok: true });
    });
    it("rejects a negative number", () => {
      expect(validateAnswerValue(item({ answerType: "number" }), -1)).toEqual({
        ok: false,
        error: "invalid_type",
      });
    });
    it("rejects a non-numeric string", () => {
      expect(validateAnswerValue(item({ answerType: "number" }), "five")).toEqual({
        ok: false,
        error: "invalid_type",
      });
    });
    it("rejects NaN/Infinity", () => {
      expect(validateAnswerValue(item({ answerType: "number" }), NaN)).toEqual({
        ok: false,
        error: "invalid_type",
      });
      expect(validateAnswerValue(item({ answerType: "number" }), Infinity)).toEqual({
        ok: false,
        error: "invalid_type",
      });
    });
  });

  describe("yes_no", () => {
    it("accepts כן/לא", () => {
      expect(validateAnswerValue(item({ answerType: "yes_no" }), "כן")).toEqual({ ok: true });
      expect(validateAnswerValue(item({ answerType: "yes_no" }), "לא")).toEqual({ ok: true });
    });
    it("rejects anything else, including the yes_no_unknown third option", () => {
      expect(validateAnswerValue(item({ answerType: "yes_no" }), "לא יודעת")).toEqual({
        ok: false,
        error: "invalid_option",
      });
      expect(validateAnswerValue(item({ answerType: "yes_no" }), "yes")).toEqual({
        ok: false,
        error: "invalid_option",
      });
    });
  });

  describe("yes_no_unknown", () => {
    it("accepts all three options", () => {
      for (const v of ["כן", "לא", "לא יודעת"]) {
        expect(validateAnswerValue(item({ answerType: "yes_no_unknown" }), v)).toEqual({
          ok: true,
        });
      }
    });
  });

  describe("single_choice", () => {
    const withOptions = item({ answerType: "single_choice", options: ["א", "ב", "ג"] });
    it("accepts a configured option", () => {
      expect(validateAnswerValue(withOptions, "ב")).toEqual({ ok: true });
    });
    it("rejects a value outside the configured options", () => {
      expect(validateAnswerValue(withOptions, "ד")).toEqual({
        ok: false,
        error: "invalid_option",
      });
    });
    it("rejects a non-string", () => {
      expect(validateAnswerValue(withOptions, ["א"])).toEqual({
        ok: false,
        error: "invalid_type",
      });
    });
  });

  describe("multi_choice", () => {
    const withOptions = item({ answerType: "multi_choice", options: ["א", "ב", "ג"] });
    it("accepts a subset of configured options", () => {
      expect(validateAnswerValue(withOptions, ["א", "ג"])).toEqual({ ok: true });
    });
    it("accepts an empty array", () => {
      expect(validateAnswerValue(withOptions, [])).toEqual({ ok: true });
    });
    it("rejects an array containing a value outside the configured options", () => {
      expect(validateAnswerValue(withOptions, ["א", "ד"])).toEqual({
        ok: false,
        error: "invalid_options",
      });
    });
    it("rejects a non-array", () => {
      expect(validateAnswerValue(withOptions, "א")).toEqual({
        ok: false,
        error: "invalid_type",
      });
    });
  });
});

describe("normalizeAnswerValue", () => {
  it("collapses a blank/whitespace-only short_text value to null", () => {
    expect(normalizeAnswerValue(item({ answerType: "short_text" }), "   ")).toBeNull();
    expect(normalizeAnswerValue(item({ answerType: "short_text" }), "")).toBeNull();
  });
  it("preserves a non-blank short_text value", () => {
    expect(normalizeAnswerValue(item({ answerType: "short_text" }), "hi")).toBe("hi");
  });
  it("collapses an empty multi_choice array to null", () => {
    expect(normalizeAnswerValue(item({ answerType: "multi_choice" }), [])).toBeNull();
  });
  it("preserves a non-empty multi_choice array", () => {
    expect(normalizeAnswerValue(item({ answerType: "multi_choice" }), ["א"])).toEqual(["א"]);
  });
  it("passes through null/undefined as null", () => {
    expect(normalizeAnswerValue(item({ answerType: "number" }), null)).toBeNull();
    expect(normalizeAnswerValue(item({ answerType: "number" }), undefined)).toBeNull();
  });
  it("does not alter a valid numeric value", () => {
    expect(normalizeAnswerValue(item({ answerType: "number" }), 5)).toBe(5);
  });
});
