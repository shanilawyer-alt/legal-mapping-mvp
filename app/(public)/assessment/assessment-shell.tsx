"use client";

import { useMemo, useState } from "react";
import type { AnswerMap, AnswerValue } from "@/domain/branching/evaluate";
import { computeEffectiveAnswers } from "@/domain/questionnaire/effective";
import type { QuestionnaireSection } from "@/domain/questionnaire/load";
import type { QuestionnaireItem } from "@/domain/questionnaire/types";
import { QuestionField } from "@/components/assessment/question-field";
import { DocumentUpload } from "@/components/assessment/document-upload";
import { SubmittedView } from "@/components/assessment/submitted-view";

type SaveState = "idle" | "saving" | "saved" | "error";
type Phase = "form" | "review" | "confirmation";

export function AssessmentShell({
  sections,
  initialAnswers,
}: {
  sections: QuestionnaireSection[];
  initialAnswers: AnswerMap;
}) {
  const [answers, setAnswers] = useState<Record<string, AnswerValue>>({ ...initialAnswers });
  const [sectionIndex, setSectionIndex] = useState(0);
  const [saveStateByQuestion, setSaveStateByQuestion] = useState<Record<string, SaveState>>({});
  const [phase, setPhase] = useState<Phase>("form");
  const [locked, setLocked] = useState(false);
  const [expired, setExpired] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submittedAt, setSubmittedAt] = useState<string | null>(null);

  const allItems = useMemo(() => sections.flatMap((s) => s.items), [sections]);
  const itemById = useMemo(() => new Map(allItems.map((item) => [item.id, item])), [allItems]);

  const { statuses } = useMemo(
    () => computeEffectiveAnswers(allItems, answers),
    [allItems, answers],
  );
  const activeIds = useMemo(
    () => new Set(statuses.filter((s) => s.active).map((s) => s.questionId)),
    [statuses],
  );
  const missingRequired = useMemo(
    () =>
      statuses.filter(
        (s) => s.active && !s.hasAnswer && itemById.get(s.questionId)?.isCore,
      ),
    [statuses, itemById],
  );

  const sectionIndexByQuestionId = useMemo(() => {
    const map = new Map<string, number>();
    sections.forEach((section, idx) => {
      for (const item of section.items) map.set(item.id, idx);
    });
    return map;
  }, [sections]);

  const currentSection = sections[sectionIndex];
  const visibleItems = useMemo(
    () => currentSection.items.filter((item) => activeIds.has(item.id)),
    [currentSection, activeIds],
  );

  async function persistAnswer(questionId: string, value: AnswerValue) {
    setSaveStateByQuestion((prev) => ({ ...prev, [questionId]: "saving" }));
    try {
      const res = await fetch("/api/assessments/answers", {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ questionId, value }),
      });
      if (res.status === 423) {
        setLocked(true);
        return;
      }
      if (res.status === 410) {
        setExpired(true);
        return;
      }
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

  function goToQuestion(questionId: string) {
    const idx = sectionIndexByQuestionId.get(questionId);
    if (idx !== undefined) setSectionIndex(idx);
    setPhase("form");
  }

  async function handleSubmit() {
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/assessments/submit", {
        method: "POST",
        credentials: "same-origin",
      });
      if (res.status === 423) {
        setLocked(true);
        return;
      }
      if (res.status === 410) {
        setExpired(true);
        return;
      }
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        if (body?.error === "missing_required") {
          setSubmitError(
            "יש להשלים את כל השדות המסומנים כחובה לפני השליחה. השדות החסרים מופיעים למטה.",
          );
        } else {
          setSubmitError("שליחת השאלון נכשלה. יש לנסות שוב.");
        }
        return;
      }
      setSubmittedAt(body?.assessment?.submittedAt ?? new Date().toISOString());
      setPhase("confirmation");
    } catch {
      setSubmitError("שליחת השאלון נכשלה. יש לבדוק את החיבור לרשת ולנסות שוב.");
    } finally {
      setSubmitting(false);
    }
  }

  if (locked) {
    return (
      <NoticeScreen
        title="השאלון כבר נשלח"
        message="השאלון נשלח לעיון ואינו ניתן לעריכה נוספת כרגע. יש לרענן את הדף כדי לראות את מסך האישור."
        actionLabel="רענון הדף"
        onAction={() => window.location.reload()}
      />
    );
  }

  if (expired) {
    return (
      <NoticeScreen
        title="תוקף הגישה פג"
        message="התשובות ששמרת נשמרו במלואן ולא אבדו. יש להשתמש שוב בקישור המקורי שנשלח אליך כדי להמשיך בדיוק מהמקום שבו הפסקת."
      />
    );
  }

  if (phase === "confirmation") {
    return <SubmittedView submittedAt={submittedAt} />;
  }

  if (phase === "review") {
    return (
      <ReviewScreen
        sections={sections}
        answers={answers}
        activeIds={activeIds}
        missingRequired={missingRequired}
        itemById={itemById}
        submitting={submitting}
        submitError={submitError}
        onEditQuestion={goToQuestion}
        onBack={() => setPhase("form")}
        onSubmit={handleSubmit}
      />
    );
  }

  const isFirstSection = sectionIndex === 0;
  const isLastSection = sectionIndex === sections.length - 1;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <ProgressBar current={sectionIndex + 1} total={sections.length + 1} />

      <h2 className="mt-6 text-xl font-semibold text-slate-900">{currentSection.domain}</h2>

      <div className="mt-6 space-y-8">
        {visibleItems.map((item) => (
          <div key={item.id}>
            <label className="block text-sm font-medium text-slate-800">
              {item.clientText}{" "}
              {item.isCore ? (
                <span className="text-xs font-normal text-red-600">(שדה חובה)</span>
              ) : (
                <span className="text-xs font-normal text-slate-400">(אופציונלי)</span>
              )}
            </label>
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
              <DocumentUpload
                documentType={item.documentTypeId ?? item.documentRequest}
                label={item.documentRequest}
              />
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
          <button
            type="button"
            onClick={() => setPhase("review")}
            className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            מעבר לסיכום ולשליחה
          </button>
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

function ReviewScreen({
  sections,
  answers,
  activeIds,
  missingRequired,
  itemById,
  submitting,
  submitError,
  onEditQuestion,
  onBack,
  onSubmit,
}: {
  sections: QuestionnaireSection[];
  answers: Record<string, AnswerValue>;
  activeIds: Set<string>;
  missingRequired: readonly { questionId: string }[];
  itemById: Map<string, QuestionnaireItem>;
  submitting: boolean;
  submitError: string | null;
  onEditQuestion: (questionId: string) => void;
  onBack: () => void;
  onSubmit: () => void;
}) {
  const canSubmit = missingRequired.length === 0 && !submitting;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <ProgressBar current={sections.length + 1} total={sections.length + 1} />

      <h2 className="mt-6 text-xl font-semibold text-slate-900">סיכום ואישור לפני שליחה</h2>
      <p className="mt-1 text-sm text-slate-500">
        יש לוודא שכל התשובות נכונות. לאחר השליחה לא ניתן יהיה לערוך את השאלון באופן עצמאי.
      </p>

      {missingRequired.length > 0 ? (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-medium text-red-800">
            נותרו שדות חובה שטרם מולאו. יש להשלים אותם לפני השליחה:
          </p>
          <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-red-700">
            {missingRequired.map(({ questionId }) => {
              const item = itemById.get(questionId);
              if (!item) return null;
              return (
                <li key={questionId}>
                  <button
                    type="button"
                    className="underline hover:no-underline"
                    onClick={() => onEditQuestion(questionId)}
                  >
                    {item.clientText}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      {submitError ? (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {submitError}
        </div>
      ) : null}

      <div className="mt-6 space-y-8">
        {sections.map((section) => {
          const visible = section.items.filter((item) => activeIds.has(item.id));
          if (visible.length === 0) return null;
          return (
            <div key={section.domain}>
              <h3 className="text-sm font-semibold text-slate-900">{section.domain}</h3>
              <dl className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-200">
                {visible.map((item) => (
                  <div key={item.id} className="flex items-start justify-between gap-4 p-3">
                    <div>
                      <dt className="text-sm text-slate-700">{item.clientText}</dt>
                      <dd className="mt-1 text-sm text-slate-500">
                        {formatAnswerForReview(answers[item.id])}
                      </dd>
                    </div>
                    <button
                      type="button"
                      className="shrink-0 text-xs text-slate-500 underline hover:no-underline"
                      onClick={() => onEditQuestion(item.id)}
                    >
                      עריכה
                    </button>
                  </div>
                ))}
              </dl>
            </div>
          );
        })}
      </div>

      <div className="mt-10 flex items-center justify-between border-t border-slate-200 pt-6">
        <button
          type="button"
          onClick={onBack}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm text-slate-700"
        >
          חזרה לעריכה
        </button>
        <button
          type="button"
          disabled={!canSubmit}
          onClick={onSubmit}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40"
        >
          {submitting ? "שולח…" : "שליחה סופית"}
        </button>
      </div>
    </div>
  );
}

function NoticeScreen({
  title,
  message,
  actionLabel,
  onAction,
}: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">{title}</h1>
        <p className="mt-3 text-sm text-slate-600">{message}</p>
        {actionLabel && onAction ? (
          <button
            type="button"
            onClick={onAction}
            className="mt-5 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function formatAnswerForReview(value: AnswerValue): string {
  if (value === null || value === undefined) return "לא נענה";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "לא נענה";
  return String(value);
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
