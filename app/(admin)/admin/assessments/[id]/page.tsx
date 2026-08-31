import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepositories } from "@/lib/db";
import { loadQuestionnaire, groupByDomain } from "@/domain/questionnaire/load";
import { computeEffectiveAnswers } from "@/domain/questionnaire/effective";
import type { AnswerValue } from "@/domain/branching/evaluate";
import { ASSESSMENT_STATUS_LABELS } from "@/domain/admin/statusLabels";
import { reopenAssessmentAction, deleteDocumentAction } from "@/app/(admin)/admin/assessments/[id]/actions";
import { ConfirmSubmitButton } from "@/components/admin/confirm-submit-button";

/**
 * Admin assessment detail (Phase 2 spec item 5/6): business profile,
 * questionnaire answers (stale ones marked, never hidden — item 18),
 * uploaded documents (view/download only via the short-lived-signed-URL
 * route, delete audited — item 6/17), and the activity/audit trail.
 * Deliberately no legal-findings section — that is Phase 3.
 */

const ERROR_MESSAGES: Record<string, string> = {
  not_found: "המיפוי לא נמצא.",
  not_reopenable: 'ניתן לפתוח מחדש רק מיפוי שנמצא במצב "נשלח — ממתין לניתוח".',
  document_not_found: "המסמך לא נמצא.",
};

const AUDIT_EVENT_LABELS: Record<string, string> = {
  link_created: "קישור מאובטח נוצר",
  session_created: "הלקוח פתח את הקישור",
  answer_submitted: "תשובה נשמרה",
  document_uploaded: "מסמך הועלה",
  document_accessed: "מסמך נצפה על ידי עורך/ת דין",
  document_deleted: "מסמך נמחק",
  assessment_submitted: "השאלון נשלח על ידי הלקוח",
  assessment_reopened: "המיפוי נפתח מחדש לעריכה",
};

function formatHebrewDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("he-IL", { dateStyle: "long", timeStyle: "short" }).format(
      new Date(iso),
    );
  } catch {
    return iso;
  }
}

function formatAnswerValue(value: AnswerValue): string {
  if (value === null || value === undefined) return "לא נענה";
  if (Array.isArray(value)) return value.length ? value.join(", ") : "לא נענה";
  return String(value);
}

export default async function AdminAssessmentDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { id } = await params;
  const { error } = await searchParams;

  const repos = getRepositories();
  const assessment = await repos.assessments.getById(id);
  if (!assessment) notFound();

  const [organization, answers, documents, auditEvents] = await Promise.all([
    repos.organizations.getById(assessment.organizationId),
    repos.answers.listByAssessment(id),
    repos.documents.listByAssessment(id),
    repos.audit.listByAssessment(id),
  ]);

  const items = loadQuestionnaire();
  const answerByQuestionId = new Map(answers.map((a) => [a.questionId, a]));
  const rawAnswerMap: Record<string, AnswerValue> = {};
  for (const a of answers) rawAnswerMap[a.questionId] = a.valueJson as AnswerValue;
  const { statuses, effectiveAnswers } = computeEffectiveAnswers(items, rawAnswerMap);
  const statusByQuestionId = new Map(statuses.map((s) => [s.questionId, s]));
  const sections = groupByDomain(items);

  const canReopen = assessment.status === "SUBMITTED";
  const employeeCount = effectiveAnswers["GEN-04"];
  const freelancerCount = effectiveAnswers["GEN-06"];

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/admin" className="text-sm text-slate-500 underline hover:no-underline">
            ← חזרה ללוח הבקרה
          </Link>
          <h1 className="mt-2 text-2xl font-semibold text-slate-900">
            {organization?.legalName ?? "—"}
          </h1>
        </div>
        {canReopen ? (
          <form action={reopenAssessmentAction.bind(null, assessment.id)}>
            <ConfirmSubmitButton
              confirmMessage="לפתוח מחדש את המיפוי לעריכה על ידי הלקוח? הפעולה תתועד ביומן הפעילות."
              className="shrink-0 rounded-md border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-100"
            >
              פתיחה מחדש לעריכה
            </ConfirmSubmitButton>
          </form>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          {ERROR_MESSAGES[error] ?? "אירעה שגיאה."}
        </div>
      ) : null}

      <nav className="flex gap-4 border-b border-slate-200 text-sm text-slate-500">
        <a href="#profile" className="border-b-2 border-transparent py-2 hover:text-slate-900">
          פרופיל עסק
        </a>
        <a href="#answers" className="border-b-2 border-transparent py-2 hover:text-slate-900">
          תשובות השאלון
        </a>
        <a href="#documents" className="border-b-2 border-transparent py-2 hover:text-slate-900">
          מסמכים
        </a>
        <a href="#audit" className="border-b-2 border-transparent py-2 hover:text-slate-900">
          יומן פעילות
        </a>
      </nav>

      <section id="profile" className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-medium text-slate-900">פרופיל עסק</h2>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <Field label="שם העסק" value={organization?.legalName ?? "—"} />
          <Field label="סטטוס" value={ASSESSMENT_STATUS_LABELS[assessment.status]} />
          <Field label="נוצר בתאריך" value={formatHebrewDate(assessment.createdAt)} />
          <Field label="נשלח בתאריך" value={formatHebrewDate(assessment.submittedAt)} />
          <Field label="עובדים שכירים" value={formatAnswerValue(employeeCount)} />
          <Field label="פרילנסרים" value={formatAnswerValue(freelancerCount)} />
        </dl>
      </section>

      <section id="answers" className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-medium text-slate-900">תשובות השאלון</h2>
        <p className="mt-1 text-xs text-slate-500">
          תשובות המסומנות &quot;לא בתוקף&quot; הוזנו לפני ששינוי בתשובה מוקדמת יותר בהסתעפות הסתיר
          את השאלה, ואינן חלק מהמיפוי הנוכחי — הן נשמרות כאן לצורך תיעוד בלבד.
        </p>
        <div className="mt-4 space-y-6">
          {answers.length === 0 ? <p className="text-sm text-slate-500">טרם הוזנו תשובות.</p> : null}
          {sections.map((section) => {
            const answeredItems = section.items.filter(
              (item) => statusByQuestionId.get(item.id)?.hasAnswer,
            );
            if (answeredItems.length === 0) return null;
            return (
              <div key={section.domain}>
                <h3 className="text-sm font-semibold text-slate-900">{section.domain}</h3>
                <dl className="mt-2 divide-y divide-slate-100 rounded-md border border-slate-200">
                  {answeredItems.map((item) => {
                    const answer = answerByQuestionId.get(item.id);
                    const status = statusByQuestionId.get(item.id);
                    return (
                      <div key={item.id} className="p-3">
                        <dt className="flex items-center gap-2 text-sm text-slate-700">
                          {item.clientText}
                          {status?.stale ? (
                            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
                              לא בתוקף
                            </span>
                          ) : null}
                        </dt>
                        <dd className="mt-1 text-sm text-slate-500">
                          {formatAnswerValue(answer?.valueJson as AnswerValue)}
                        </dd>
                      </div>
                    );
                  })}
                </dl>
              </div>
            );
          })}
        </div>
      </section>

      <section id="documents" className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-medium text-slate-900">מסמכים שהועלו</h2>
        {documents.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">לא הועלו מסמכים.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100 rounded-md border border-slate-200">
            {documents.map((doc) => (
              <li key={doc.id} className="flex items-center justify-between gap-4 p-3 text-sm">
                <div>
                  <p className="font-medium text-slate-800">{doc.originalFilename}</p>
                  <p className="text-xs text-slate-500">
                    {doc.documentType} · הועלה {formatHebrewDate(doc.uploadedAt)}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <a
                    href={`/admin/documents/${doc.id}/download`}
                    className="text-xs font-medium text-slate-900 underline hover:no-underline"
                  >
                    צפייה / הורדה
                  </a>
                  <form action={deleteDocumentAction.bind(null, assessment.id, doc.id)}>
                    <ConfirmSubmitButton
                      confirmMessage="למחוק את המסמך? הפעולה בלתי הפיכה ותתועד ביומן הפעילות."
                      className="text-xs font-medium text-red-600 underline hover:no-underline"
                    >
                      מחיקה
                    </ConfirmSubmitButton>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="audit" className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-medium text-slate-900">יומן פעילות</h2>
        {auditEvents.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">אין אירועים מתועדים.</p>
        ) : (
          <ul className="mt-4 space-y-2 text-sm">
            {[...auditEvents].reverse().map((event) => (
              <li
                key={event.id}
                className="flex items-center justify-between border-b border-slate-100 pb-2"
              >
                <span className="text-slate-700">
                  {AUDIT_EVENT_LABELS[event.eventType] ?? event.eventType}
                </span>
                <span className="text-xs text-slate-400">{formatHebrewDate(event.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-slate-500">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium text-slate-900">{value}</dd>
    </div>
  );
}
