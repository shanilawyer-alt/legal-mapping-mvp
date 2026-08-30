import { getRepositories } from "@/lib/db";
import { resolveAssessmentByToken } from "@/domain/assessment/service";
import { loadQuestionnaire, groupByDomain } from "@/domain/questionnaire/load";
import type { AnswerMap } from "@/domain/branching/evaluate";
import { AssessmentShell } from "@/app/(public)/assessment/[token]/assessment-shell";

export default async function AssessmentPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const repos = getRepositories();
  const resolved = await resolveAssessmentByToken(repos, token);

  if (!resolved.ok) {
    return <AccessError error={resolved.error} />;
  }

  const answers = await repos.answers.listByAssessment(resolved.assessment.id);
  const initialAnswers: AnswerMap = Object.fromEntries(
    answers.map((a) => [a.questionId, a.valueJson as never]),
  );

  const sections = groupByDomain(loadQuestionnaire());

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-200 bg-slate-50 px-4 py-4 text-center">
        <h1 className="text-lg font-semibold text-slate-900">מיפוי משפטי לעסק</h1>
        <p className="mt-1 text-sm text-slate-500">
          כל תשובה נשמרת אוטומטית. ניתן לצאת ולחזור באמצעות אותו קישור.
        </p>
      </header>
      <AssessmentShell token={token} sections={sections} initialAnswers={initialAnswers} />
    </div>
  );
}

function AccessError({ error }: { error: "not_found" | "expired" }) {
  const message =
    error === "not_found"
      ? "הקישור שגוי או שאינו קיים. יש לבדוק את הקישור שנשלח, או לפנות למשרד עורכי הדין לקבלת קישור חדש."
      : "תוקף הקישור פג. יש לפנות למשרד עורכי הדין לקבלת קישור חדש.";

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">לא ניתן להציג את השאלון</h1>
        <p className="mt-3 text-sm text-slate-600">{message}</p>
      </div>
    </div>
  );
}
