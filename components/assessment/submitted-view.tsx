function formatHebrewDate(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat("he-IL", {
      dateStyle: "long",
      timeStyle: "short",
    }).format(new Date(iso));
  } catch {
    return null;
  }
}

/**
 * The client-facing confirmation/locked view (Phase 2 spec item 1 & 2).
 * Used both right after a successful in-session submit
 * (app/(public)/assessment/assessment-shell.tsx) and — critically — on a
 * fresh page load of an assessment that is no longer DRAFT
 * (app/(public)/assessment/page.tsx), so reloading the page after
 * submitting always shows this, not a stale editable form.
 */
export function SubmittedView({ submittedAt }: { submittedAt: string | null }) {
  const formatted = formatHebrewDate(submittedAt);
  return (
    <div className="flex min-h-[60vh] items-center justify-center px-4">
      <div className="max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">השאלון נשלח בהצלחה</h1>
        <p className="mt-3 text-sm text-slate-600">
          תודה על מילוי השאלון. הפרטים שמסרת יועברו לבדיקה על ידי עורך/ת דין.
        </p>
        {formatted ? <p className="mt-2 text-xs text-slate-400">נשלח בתאריך {formatted}</p> : null}
        <p className="mt-4 text-sm text-slate-600">
          לא ניתן לערוך את התשובות באופן עצמאי כעת. אם יש צורך בעדכון פרטים, יש לפנות למשרד עורכי
          הדין ששלח את הקישור.
        </p>
      </div>
    </div>
  );
}
