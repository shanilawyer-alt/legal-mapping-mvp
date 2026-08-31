import Link from "next/link";
import { getRepositories } from "@/lib/db";
import { listAdminAssessmentSummaries } from "@/domain/admin/dashboard";
import { ASSESSMENT_STATUS_LABELS } from "@/domain/admin/statusLabels";
import { CreateAssessmentForm } from "@/app/(admin)/admin/create-assessment-form";

function formatHebrewDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short" }).format(
      new Date(iso),
    );
  } catch {
    return iso;
  }
}

export default async function AdminHomePage() {
  const repos = getRepositories();
  const summaries = await listAdminAssessmentSummaries(repos);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">לוח בקרה</h1>
        <p className="mt-1 text-sm text-slate-500">
          יצירת מיפוי והפקת קישור מאובטח, ורשימת כל המיפויים הקיימים.
        </p>
      </div>

      <CreateAssessmentForm />

      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-medium text-slate-900">מיפויים ({summaries.length})</h2>
        </div>

        {summaries.length === 0 ? (
          <p className="px-6 py-8 text-center text-sm text-slate-500">עדיין לא נוצרו מיפויים.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-slate-200 text-sm">
              <thead>
                <tr className="text-right text-xs font-medium uppercase tracking-wide text-slate-500">
                  <th scope="col" className="px-4 py-3">
                    עסק
                  </th>
                  <th scope="col" className="px-4 py-3">
                    סטטוס
                  </th>
                  <th scope="col" className="px-4 py-3">
                    נוצר בתאריך
                  </th>
                  <th scope="col" className="px-4 py-3">
                    פעילות אחרונה
                  </th>
                  <th scope="col" className="px-4 py-3">
                    שדות חובה שמולאו
                  </th>
                  <th scope="col" className="px-4 py-3">
                    עובדים
                  </th>
                  <th scope="col" className="px-4 py-3">
                    פרילנסרים
                  </th>
                  <th scope="col" className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {summaries.map((s) => (
                  <tr key={s.id} className="text-slate-700">
                    <td className="px-4 py-3 font-medium text-slate-900">{s.organizationName}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={s.status} />
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {formatHebrewDate(s.createdAt)}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {formatHebrewDate(s.lastActivityAt)}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {s.requiredAnswered} / {s.requiredTotal}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {s.employeeCount ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-slate-500">
                      {s.freelancerCount ?? "—"}
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/admin/assessments/${s.id}`}
                        className="text-xs font-medium text-slate-900 underline hover:no-underline"
                      >
                        פתיחה
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

const STATUS_BADGE_CLASS: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-700",
  SUBMITTED: "bg-amber-100 text-amber-800",
  ANALYZED: "bg-blue-100 text-blue-800",
  LAWYER_REVIEW: "bg-indigo-100 text-indigo-800",
  APPROVED: "bg-emerald-100 text-emerald-800",
  CLIENT_REPORT_RELEASED: "bg-emerald-100 text-emerald-800",
};

function StatusBadge({ status }: { status: keyof typeof ASSESSMENT_STATUS_LABELS }) {
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_BADGE_CLASS[status] ?? "bg-slate-100 text-slate-700"}`}
    >
      {ASSESSMENT_STATUS_LABELS[status]}
    </span>
  );
}
