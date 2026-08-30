"use client";

import { useMemo, useState } from "react";
import { evaluateCondition, type AnswerMap, type AnswerValue } from "@/domain/branching/evaluate";
import type { QuestionnaireSection } from "@/domain/questionnaire/load";
import { QuestionField } from "@/components/assessment/question-field";
import { DocumentUpload } from "@/components/assessment/document-upload";

type SaveState = "idle" | "saving" | "saved" | "error";

export function AssessmentShell({
  token,
  sections,
  initialAnswers,
}: {
  token: string;
  sections: QuestionnaireSection[];
  initialAnswers: AnswerMap;
}) {
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({ ...initialAnswers });
  const [sectionIndex, setSectionIndex] = useState(0);
  const [saveStateByQuestion, setSaveStateByQuestion] = useState<Record<string, SaveState>>({});

  const currentSection = sections[sectionIndex];

  const visibleItems = useMemo(
    () => currentSection.items.filter((item) => evaluateCondition(item.triggerCondition, answers)),
    [currentSection, answers],
  );

  async function persistAnswer(questionId: string, value: AnswerValue) {
    setSaveStateByQuestion((prev) => ({ ...prev, [questionId]: "saving" }));
    try {
      const res = await fetch("/api/assessments/answers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, questionId, value }),
      });
      setSaveStateByQuestion((prev) => ({
        ...prev,
        [questionId]: res.ok ? "saved" : "error",
      }));
    } catch {
      setSaveStateByQuestion((prev) => ({ ...prev, [questionId]: "error" }));
    }
  }

  function setAnswer(questionId: string, value: AnswerValue) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  const isFirstSection = sectionIndex === 0;
  const isLastSection = sectionIndex === sections.length - 1;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <ProgressBar current={sectionIndex + 1} total={sections.length} />

      <h2 className="mt-6 text-xl font-semibold text-slate-900">{currentSection.domain}</h2>

      <div className="mt-6 space-y-8">
        {visibleItems.map((item) => (
          <div key={item.id}>
            <label className="block text-sm font-medium text-slate-800">{item.clientText}</label>
            <div className="mt-2">
              <QuestionField
                item={item}
                value={answers[item.id]}
                onChange={(value) => setAnswer(item.id, value)}
                onCommit={() => persistAnswer(item.id, answers[item.id] ?? null)}
              />
            </div>
            <SaveIndicator state={saveStateByQuestion[item.id]} />
            {item.documentRequest ? (
              <DocumentUpload token={token} documentType={item.documentRequest} label={item.documentRequest} />
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-10 flex items-center justify-between border-t border-slate-200 pt-6">
        <button
          type="button"
          disabled={isFirstSection}
          onClick={() => setSectionIndex((i) => Math.max(0, i - 1))}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700 disabled:opacity-40"
        >
          הקודם
        </button>
        {isLastSection ? (
          <span className="text-sm text-slate-500">זהו החלק האחרון בשלב זה של השאלון.</span>
        ) : (
          <button
            type="button"
            onClick={() => setSectionIndex((i) => Math.min(sections.length - 1, i + 1))}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            הבא
          </button>
        )}
      </div>
    </div>
  );
}

function ProgressBar({ current, total }: { current: number; total: number }) {
  const pct = Math.round((current / total) * 100);
  return (
    <div>
      <div className="flex justify-between text-xs text-slate-500">
        <span>
          שלב {current} מתוך {total}
        </span>
        <span>{pct}%</span>
      </div>
      <div className="mt-1 h-1.5 w-full rounded-full bg-slate-200">
        <div
          className="h-1.5 rounded-full bg-slate-900 transition-all"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

function SaveIndicator({ state }: { state?: SaveState }) {
  if (!state || state === "idle") return null;
  if (state === "saving") return <p className="mt-1 text-xs text-slate-400">שומר…</p>;
  if (state === "saved") return <p className="mt-1 text-xs text-emerald-600">נשמר</p>;
  return <p className="mt-1 text-xs text-red-600">שמירה נכשלה — יש לנסות שוב.</p>;
}
