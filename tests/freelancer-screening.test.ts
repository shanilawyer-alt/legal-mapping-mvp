import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseCsv } from "@/domain/csv/parse";
import { freelancerScreeningRowSchema } from "@/domain/csv/schemas";
import {
  computeFreelancerScreening,
  FREELANCER_SCREENING_DISCLOSURE,
} from "@/domain/rules/freelancerScreening";
import { validateFreelancerScreening } from "@/domain/rules/validateFreelancerScreening";
import type { FactMap } from "@/domain/facts/types";

describe("SCREENING_MODEL matches freelancer_screening_model.csv exactly", () => {
  const csvText = readFileSync(join(__dirname, "..", "data", "freelancer_screening_model.csv"), "utf-8");
  const { rows, errors } = parseCsv(csvText, freelancerScreeningRowSchema);

  it("has zero row-level validation errors in the real CSV", () => {
    expect(errors).toEqual([]);
  });

  it("has exactly 14 rows", () => {
    expect(rows).toHaveLength(14);
  });

  it("has zero issues cross-checking the model against the real CSV", () => {
    expect(validateFreelancerScreening(rows)).toEqual([]);
  });
});

describe("computeFreelancerScreening", () => {
  it("contributes nothing from an empty fact map", () => {
    const result = computeFreelancerScreening({});
    expect(result.totalPoints).toBe(0);
    expect(result.indicators.every((i) => !i.contributed)).toBe(true);
  });

  it("always includes the mandatory disclosure, verbatim", () => {
    const result = computeFreelancerScreening({});
    expect(result.disclosure).toBe(
      "The screening score reflects accumulated factual indicators and does not determine the legal status of the service provider.",
    );
    expect(result.disclosure).toBe(FREELANCER_SCREENING_DISCLOSURE);
  });

  it("does not compute a LOW/MEDIUM/SIGNIFICANT/HIGH level — no source-defined thresholds (OPEN_QUESTIONS item 27)", () => {
    const result = computeFreelancerScreening({});
    expect(result).not.toHaveProperty("level");
  });

  it("never asserts a legal-status conclusion anywhere in its output shape", () => {
    const result = computeFreelancerScreening({ "answer.FR-04": "לא", "answer.FR-06": "חייב לבצע אישית" });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/employee|עובד\s*שכיר\b.*(קבע|נקבע)/);
  });

  it("sums all risk-increasing indicators (spec fixture D: no other clients, fixed hours, personal performance, company equipment/email, manager, leave approval)", () => {
    const facts: FactMap = {
      "answer.FR-04": "לא", // no other clients: +10
      "answer.FR-05": "העסק", // business sets hours: +10
      "answer.FR-06": "חייב לבצע אישית", // personal performance: +10
      "answer.FR-07": "כן", // manager gives instructions: +10
      "answer.FR-08": "במשרדי העסק", // works at business premises: +5
      "answer.FR-09": "העסק", // business provides equipment: +5
      "answer.FR-10": "כן", // company email/systems: +10
      "answer.FR-11": "כן", // regular meetings: +5
      "answer.FR-12": "כן", // leave approval required: +10
      "answer.FR-13": "כן", // employees do similar work: +10
      "answer.FR-14": "כן", // was/became an employee: +10
      "answer.FR-03": ["סכום חודשי קבוע"], // fixed monthly payment: +5
    };
    const result = computeFreelancerScreening(facts);
    expect(result.totalPoints).toBe(10 + 10 + 10 + 10 + 5 + 5 + 10 + 5 + 10 + 10 + 10 + 5); // 100
    expect(result.indicators.filter((i) => i.contributed)).toHaveLength(12);
  });

  it("subtracts risk-decreasing indicators when their opposite condition holds", () => {
    const facts: FactMap = {
      "answer.FR-04": "כן", // has other clients: -5
      "answer.FR-06": "יכול להיעזר באחרים", // can get help from others: -10
    };
    const result = computeFreelancerScreening(facts);
    expect(result.totalPoints).toBe(-15);
  });

  it("FR-04 and FR-06 each contribute at most one of their two mutually-exclusive indicators", () => {
    const noOtherClients = computeFreelancerScreening({ "answer.FR-04": "לא" });
    const fr04Contributed = noOtherClients.indicators.filter(
      (i) => i.questionId === "FR-04" && i.contributed,
    );
    expect(fr04Contributed).toHaveLength(1);
    expect(fr04Contributed[0].points).toBe(10);

    const hasOtherClients = computeFreelancerScreening({ "answer.FR-04": "כן" });
    const fr04ContributedOther = hasOtherClients.indicators.filter(
      (i) => i.questionId === "FR-04" && i.contributed,
    );
    expect(fr04ContributedOther).toHaveLength(1);
    expect(fr04ContributedOther[0].points).toBe(-5);
  });

  it("a middle FR-06 option ('תלוי באישור העסק') contributes neither FR-06 indicator", () => {
    const result = computeFreelancerScreening({ "answer.FR-06": "תלוי באישור העסק" });
    const fr06 = result.indicators.filter((i) => i.questionId === "FR-06" && i.contributed);
    expect(fr06).toHaveLength(0);
  });

  it("FR-03 (multi_choice) contributes when either qualifying payment option is selected", () => {
    expect(
      computeFreelancerScreening({ "answer.FR-03": ["לפי שעות"] }).totalPoints,
    ).toBe(5);
    expect(
      computeFreelancerScreening({ "answer.FR-03": ["לפי פרויקט"] }).totalPoints,
    ).toBe(0);
  });

  it("is deterministic: identical facts always produce identical results", () => {
    const facts: FactMap = { "answer.FR-04": "לא", "answer.FR-07": "כן" };
    expect(computeFreelancerScreening(facts)).toEqual(computeFreelancerScreening(facts));
  });
});
