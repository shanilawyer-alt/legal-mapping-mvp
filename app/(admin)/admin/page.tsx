import { CreateAssessmentForm } from "@/app/(admin)/admin/create-assessment-form";

export default function AdminHomePage() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">לוח בקרה</h1>
        <p className="mt-1 text-sm text-slate-500">
          Phase 1: יצירת מיפוי והפקת קישור מאובטח. רשימת מיפויים מלאה, עדכון סטטוס וצפייה
          בממצאים יתווספו בשלבים הבאים.
        </p>
      </div>
      <CreateAssessmentForm />
    </div>
  );
}
