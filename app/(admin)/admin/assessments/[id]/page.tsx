import Link from "next/link";
import { notFound } from "next/navigation";
import { getRepositories } from "@/lib/db";
import { loadQuestionnaire, groupByDomain } from "@/domain/questionnaire/load";
import { computeEffectiveAnswers } from "@/domain/questionnaire/effective";
import type { AnswerValue } from "@/domain/branching/evaluate";
import { ASSESSMENT_STATUS_LABELS } from "@/domain/admin/statusLabels";
import { buildFactBundle } from "@/domain/facts/bundle";
import { runCrossChecks } from "@/domain/crosscheck";
import { RULE_CATALOG_BY_ID } from "@/domain/rules/catalog";
import type { FindingStatus, RiskLevel } from "@/lib/db/types";
import {
  deleteDocumentAction,
  runAnalysisAction,
  reviewFindingAction,
  approveAssessmentAction,
  generatePreviewAction,
  releaseClientReportAction,
} from "@/app/(admin)/admin/assessments/[id]/actions";
import { ConfirmSubmitButton } from "@/components/admin/confirm-submit-button";

/**
 * Admin assessment detail (Phase 2 spec item 5/6): business profile,
 * questionnaire answers (stale ones marked, never hidden — item 18),
 * uploaded documents (view/download only via the short-lived-signed-URL
 * route, delete audited — item 6/17), and the activity/audit trail.
 * Deliberately no legal-findings section — that is Phase 3.
 *
 * Deliberately no reopen action here either. See OPEN_QUESTIONS.md item
 * 16 — reopen is policy-sensitive (who may do it, whether it should be
 * unconditional, what happens to existing findings/reports) and the
 * source spec did not settle that explicitly, so it is not exposed in
 * this or any other application flow until approved.
 */

const ERROR_MESSAGES: Record<string, string> = {
  not_found: "המיפוי לא נמצא.",
  document_not_found: "המסמך לא נמצא.",
  not_submitted: "ניתן להריץ ניתוח רק על מיפוי שנשלח על ידי הלקוח.",
  not_lawyer_review: "פעולה זו אפשרית רק בעת בדיקת עורך/ת דין.",
  unresolved_critical_findings: "לא ניתן לאשר: קיימים ממצאים ברמת סיכון קריטית שטרם נבדקו (טיוטה).",
  not_approved: "ניתן לשלוח דוח ללקוח רק לאחר אישור המיפוי.",
  override_requires_reason: "שינוי חומרה ידני מחייב נימוק.",
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
  analysis_run: "ניתוח הורץ",
  finding_reviewed: "ממצא נבדק",
  assessment_approved: "המיפוי אושר",
  report_generated: "תצוגה מקדימה של דוח נוצרה",
  report_released: "דוח נשלח ללקוח",
};

const FINDING_STATUS_LABELS: Record<FindingStatus, string> = {
  draft: "טיוטה",
  confirmed: "אושר",
  modified: "שונה",
  dismissed: "נדחה",
};

const RISK_LEVEL_LABELS: Record<RiskLevel, string> = {
  LOW: "נמוך",
  MEDIUM: "בינוני",
  SIGNIFICANT: "משמעותי",
  HIGH: "גבוה",
  CRITICAL: "קריטי",
};

const RISK_LEVEL_BADGE_CLASSES: Record<RiskLevel, string> = {
  LOW: "bg-slate-100 text-slate-700",
  MEDIUM: "bg-amber-100 text-amber-800",
  SIGNIFICANT: "bg-orange-100 text-orange-800",
  HIGH: "bg-red-100 text-red-800",
  CRITICAL: "bg-red-600 text-white",
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

  const [organization, answers, documents, auditEvents, findings, ruleEvaluations, derivedFacts, documentExtractions, reports] =
    await Promise.all([
      repos.organizations.getById(assessment.organizationId),
      repos.answers.listByAssessment(id),
      repos.documents.listByAssessment(id),
      repos.audit.listByAssessment(id),
      repos.findings.listByAssessment(id),
      repos.ruleEvaluations.listByAssessment(id),
      repos.derivedFacts.listByAssessment(id),
      repos.documentExtractions.listByAssessment(id),
      repos.reports.listByAssessment(id),
    ]);

  const items = loadQuestionnaire();
  const answerByQuestionId = new Map(answers.map((a) => [a.questionId, a]));
  const rawAnswerMap: Record<string, AnswerValue> = {};
  for (const a of answers) rawAnswerMap[a.questionId] = a.valueJson as AnswerValue;
  const { statuses, effectiveAnswers } = computeEffectiveAnswers(items, rawAnswerMap);
  const statusByQuestionId = new Map(statuses.map((s) => [s.questionId, s]));
  const sections = groupByDomain(items);

  const employeeCount = effectiveAnswers["GEN-04"];
  const freelancerCount = effectiveAnswers["GEN-06"];

  // Which Rule ID produced each finding (spec §15/§F) — findings only
  // store `ruleEvaluationId`, so join back through the persisted
  // rule_evaluations the same way the report generator does.
  const ruleEvaluationById = new Map(ruleEvaluations.map((e) => [e.id, e]));

  // Cross-check issues (spec F: "inspect cross-check issues") are never
  // persisted as their own rows (see OPEN_QUESTIONS.md — the cross-check
  // engine only persists the *facts* it derives, task #47/#50); the
  // engine is a pure function of answers + extractions, so its issue
  // list is recomputed live here for display only — nothing here writes
  // anything or re-runs analysis (item 24 stays single-run).
  const baseBundle = buildFactBundle({ answers, items, storedFacts: [] });
  const crossCheckIssues = runCrossChecks(baseBundle.map, documentExtractions, id).issues;

  const canRunAnalysis = assessment.status === "SUBMITTED";
  const canApprove = assessment.status === "LAWYER_REVIEW";
  const canRelease = assessment.status === "APPROVED";

  return (
    <div className="space-y-8">
      <div>
        <Link href="/admin" className="text-sm text-slate-500 underline hover:no-underline">
          ← חזרה ללוח הבקרה
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-slate-900">
          {organization?.legalName ?? "—"}
        </h1>
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
        <a href="#facts" className="border-b-2 border-transparent py-2 hover:text-slate-900">
          עובדות שחולצו
        </a>
        <a href="#crosschecks" className="border-b-2 border-transparent py-2 hover:text-slate-900">
          הצלבות
        </a>
        <a href="#findings" className="border-b-2 border-transparent py-2 hover:text-slate-900">
          ממצאים
        </a>
        <a href="#reports" className="border-b-2 border-transparent py-2 hover:text-slate-900">
          דוחות
        </a>
        <a href="#audit" className="border-b-2 border-transparent py-2 hover:text-slate-900">
          יומן פעילות
        </a>
      </nav>

      <section id="profile" className="rounded-lg border border-slate-200 bg-white p-6">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-medium text-slate-900">פרופיל עסק</h2>
          <div className="flex shrink-0 flex-wrap gap-2">
            {canRunAnalysis ? (
              <form
                action={runAnalysisAction.bind(null, assessment.id)}
                className="flex flex-col items-end gap-1 rounded-md border border-dashed border-amber-300 bg-amber-50 p-2"
              >
                <label className="text-xs text-amber-800">
                  תג פיקסצ&apos;ר לפיילוט מבוקר בלבד — יש להשאיר ריק עבור לקוח אמיתי
                  <select
                    name="pilotFixtureTag"
                    defaultValue=""
                    className="mt-1 block w-full rounded border border-amber-300 bg-white px-2 py-1 text-xs"
                  >
                    <option value="">— ריק (התנהגות אמיתית, ללא חילוץ AI) —</option>
                    <option value="A-clean">A-clean</option>
                    <option value="B-overtime-mismatch">B-overtime-mismatch</option>
                    <option value="C-privacy-gap">C-privacy-gap</option>
                    <option value="D-freelancer-dependency">D-freelancer-dependency</option>
                  </select>
                </label>
                <ConfirmSubmitButton
                  confirmMessage="להריץ ניתוח על המיפוי? הפעולה תסמן את המיפוי כ'בבדיקת עורך/ת דין' ולא ניתן יהיה להריץ שוב. תג פיקסצ'ר משמש לפיילוט מבוקר בלבד — לעולם לא עבור לקוח אמיתי."
                  className="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                >
                  הרצת ניתוח
                </ConfirmSubmitButton>
              </form>
            ) : null}
            {canApprove ? (
              <form action={approveAssessmentAction.bind(null, assessment.id)}>
                <ConfirmSubmitButton
                  confirmMessage="לאשר את המיפוי? האישור חסום כל עוד קיימים ממצאים ברמת סיכון קריטית בטיוטה."
                  className="rounded-md bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-500"
                >
                  אישור מיפוי
                </ConfirmSubmitButton>
              </form>
            ) : null}
            {canRelease ? (
              <form action={releaseClientReportAction.bind(null, assessment.id)}>
                <ConfirmSubmitButton
                  confirmMessage="לשלוח דוח ללקוח? הפעולה בלתי הפיכה — הדוח יכלול רק ממצאים שסומנו כגלויים ללקוח."
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-500"
                >
                  שליחת דוח ללקוח
                </ConfirmSubmitButton>
              </form>
            ) : null}
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
          <Field label="שם העסק" value={organization?.legalName ?? "—"} />
          <Field label="סטטוס" value={ASSESSMENT_STATUS_LABELS[assessment.status]} />
          <Field label="נוצר בתאריך" value={formatHebrewDate(assessment.createdAt)} />
          <Field label="נשלח בתאריך" value={formatHebrewDate(assessment.submittedAt)} />
          <Field label="אושר בתאריך" value={formatHebrewDate(assessment.approvedAt)} />
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

      <section id="facts" className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-medium text-slate-900">עובדות שחולצו</h2>
        <p className="mt-1 text-xs text-slate-500">
          עובדות מנורמלות שנגזרו ממסמכים ומהצלבות, כל אחת עם מקור ורמת ודאות (1–4). תשובות
          השאלון עצמן מוצגות למעלה ואינן חוזרות כאן.
        </p>
        {derivedFacts.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            {canRunAnalysis ? "טרם הורץ ניתוח." : "לא נגזרו עובדות."}
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100 rounded-md border border-slate-200 text-sm">
            {derivedFacts.map((fact) => (
              <li key={fact.id} className="p-3">
                <p className="font-mono text-xs text-slate-500">{fact.factKey}</p>
                <p className="mt-1 text-slate-800">{JSON.stringify(fact.valueJson)}</p>
                <p className="mt-1 text-xs text-slate-400">
                  מקור: {fact.sourceType} · ודאות: {fact.confidence ?? "—"}/4
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="crosschecks" className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-medium text-slate-900">הצלבות</h2>
        <p className="mt-1 text-xs text-slate-500">
          השוואות דטרמיניסטיות בין תשובות, מסמכים ועובדות שנגזרו — לתשומת לב עורך/ת הדין בלבד;
          אינן ממצא משפטי כשלעצמן.
        </p>
        {crossCheckIssues.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">לא זוהו סתירות או פערי ראיות.</p>
        ) : (
          <ul className="mt-4 space-y-2 text-sm">
            {crossCheckIssues.map((issue) => (
              <li key={issue.factKey} className="rounded-md border border-amber-200 bg-amber-50 p-3">
                <p className="text-amber-900">{issue.description}</p>
                <p className="mt-1 text-xs text-amber-700">
                  סוג: {issue.issueType} · מבוסס על: {issue.basedOn.join(", ")}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section id="findings" className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-medium text-slate-900">ממצאים</h2>
        {findings.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">
            {canRunAnalysis ? "טרם הורץ ניתוח." : "לא נוצרו ממצאים."}
          </p>
        ) : (
          <ul className="mt-4 space-y-4">
            {findings.map((finding) => {
              const evaluation = finding.ruleEvaluationId
                ? ruleEvaluationById.get(finding.ruleEvaluationId)
                : undefined;
              const rule = evaluation ? RULE_CATALOG_BY_ID.get(evaluation.ruleId) : undefined;
              return (
                <li key={finding.id} className="rounded-md border border-slate-200 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-semibold text-slate-900">{finding.internalTitle}</p>
                      <p className="text-xs text-slate-500">
                        {finding.category}
                        {evaluation ? ` · Rule ID: ${evaluation.ruleId}` : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {finding.riskLevel ? (
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-medium ${RISK_LEVEL_BADGE_CLASSES[finding.riskLevel]}`}
                        >
                          {RISK_LEVEL_LABELS[finding.riskLevel]}
                        </span>
                      ) : null}
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700">
                        {FINDING_STATUS_LABELS[finding.status]}
                      </span>
                    </div>
                  </div>

                  <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-500 sm:grid-cols-4">
                    <div>
                      <dt>ציון סיכון</dt>
                      <dd className="text-slate-800">{finding.riskScore ?? "—"}/100</dd>
                    </div>
                    <div>
                      <dt>רמת ודאות</dt>
                      <dd className="text-slate-800">{finding.confidence ?? "—"}/4</dd>
                    </div>
                    <div>
                      <dt>גלוי ללקוח</dt>
                      <dd className="text-slate-800">{finding.visibleToClient ? "כן" : "לא"}</dd>
                    </div>
                    <div>
                      <dt>נבדק על ידי</dt>
                      <dd className="text-slate-800">{finding.reviewedBy ?? "—"}</dd>
                    </div>
                  </dl>

                  {finding.recommendedAction ? (
                    <p className="mt-2 text-sm text-slate-700">
                      <span className="font-medium">המלצה: </span>
                      {finding.recommendedAction}
                    </p>
                  ) : null}
                  {finding.draftInternalText ? (
                    <p className="mt-1 text-xs text-slate-500">
                      <span className="font-medium">הערת זהירות: </span>
                      {finding.draftInternalText}
                    </p>
                  ) : null}
                  {rule?.legalSourceUrl ? (
                    <p className="mt-1 text-xs">
                      <a
                        href={rule.legalSourceUrl}
                        className="text-slate-500 underline hover:no-underline"
                        target="_blank"
                        rel="noreferrer"
                      >
                        מקור משפטי
                      </a>
                    </p>
                  ) : null}
                  {evaluation ? (
                    <details className="mt-2 text-xs text-slate-500">
                      <summary className="cursor-pointer">נתונים תומכים</summary>
                      <pre className="mt-1 whitespace-pre-wrap rounded bg-slate-50 p-2">
                        {JSON.stringify(evaluation.inputSnapshot, null, 2)}
                      </pre>
                    </details>
                  ) : null}
                  {finding.severityOverride != null ? (
                    <p className="mt-2 text-xs text-slate-600">
                      חומרה שונתה ידנית ל-{finding.severityOverride} — נימוק: {finding.overrideReason}
                    </p>
                  ) : null}
                  {finding.lawyerNotes ? (
                    <p className="mt-1 text-xs text-slate-600">הערת עו&quot;ד: {finding.lawyerNotes}</p>
                  ) : null}

                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
                    <form action={reviewFindingAction.bind(null, assessment.id, finding.id)}>
                      <input type="hidden" name="status" value="confirmed" />
                      <button
                        type="submit"
                        className="rounded-md border border-emerald-200 px-2 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                      >
                        אישור
                      </button>
                    </form>
                    <form action={reviewFindingAction.bind(null, assessment.id, finding.id)}>
                      <input type="hidden" name="status" value="dismissed" />
                      <button
                        type="submit"
                        className="rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
                      >
                        דחייה
                      </button>
                    </form>
                    <form action={reviewFindingAction.bind(null, assessment.id, finding.id)}>
                      <input type="hidden" name="visibleToClient" value={finding.visibleToClient ? "false" : "true"} />
                      <button
                        type="submit"
                        className="rounded-md border border-blue-200 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-50"
                      >
                        {finding.visibleToClient ? "הסתרה מהלקוח" : "הצגה ללקוח"}
                      </button>
                    </form>
                  </div>

                  <form
                    action={reviewFindingAction.bind(null, assessment.id, finding.id)}
                    className="mt-3 flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3"
                  >
                    <input type="hidden" name="status" value="modified" />
                    <label className="text-xs text-slate-500">
                      חומרה ידנית (1–5)
                      <input
                        type="number"
                        name="severityOverride"
                        min={1}
                        max={5}
                        required
                        className="mt-1 block w-20 rounded border border-slate-300 px-2 py-1 text-xs"
                      />
                    </label>
                    <label className="grow text-xs text-slate-500">
                      נימוק (חובה בעת שינוי חומרה)
                      <input
                        type="text"
                        name="overrideReason"
                        required
                        className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-xs"
                      />
                    </label>
                    <button
                      type="submit"
                      className="rounded-md bg-slate-900 px-2 py-1.5 text-xs font-medium text-white hover:bg-slate-700"
                    >
                      שמירת שינוי חומרה
                    </button>
                  </form>

                  <form
                    action={reviewFindingAction.bind(null, assessment.id, finding.id)}
                    className="mt-2 flex flex-wrap items-end gap-2"
                  >
                    <label className="grow text-xs text-slate-500">
                      הוספת הערה
                      <input
                        type="text"
                        name="lawyerNotes"
                        className="mt-1 block w-full rounded border border-slate-300 px-2 py-1 text-xs"
                      />
                    </label>
                    <button
                      type="submit"
                      className="rounded-md border border-slate-300 px-2 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                    >
                      שמירת הערה
                    </button>
                  </form>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section id="reports" className="rounded-lg border border-slate-200 bg-white p-6">
        <h2 className="text-lg font-medium text-slate-900">דוחות</h2>
        <p className="mt-1 text-xs text-slate-500">
          תצוגה מקדימה בלבד — הדוח ללקוח כולל רק ממצאים שסומנו &quot;הצגה ללקוח&quot;, ולעולם לא
          נשלח אוטומטית.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <form action={generatePreviewAction.bind(null, assessment.id, "internal")}>
            <button
              type="submit"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              יצירת תצוגה מקדימה — דוח פנימי
            </button>
          </form>
          <form action={generatePreviewAction.bind(null, assessment.id, "client")}>
            <button
              type="submit"
              className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
            >
              יצירת תצוגה מקדימה — דוח ללקוח
            </button>
          </form>
        </div>
        {reports.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">טרם נוצרו דוחות.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-100 rounded-md border border-slate-200 text-sm">
            {[...reports].reverse().map((report) => (
              <li key={report.id} className="flex items-center justify-between gap-4 p-3">
                <div>
                  <p className="font-medium text-slate-800">
                    {report.reportType === "internal" ? "דוח פנימי" : "דוח ללקוח"} · גרסה {report.version}
                  </p>
                  <p className="text-xs text-slate-500">נוצר {formatHebrewDate(report.generatedAt)}</p>
                </div>
                <a
                  href={`/admin/reports/${report.id}/download`}
                  className="shrink-0 text-xs font-medium text-slate-900 underline hover:no-underline"
                >
                  צפייה
                </a>
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
