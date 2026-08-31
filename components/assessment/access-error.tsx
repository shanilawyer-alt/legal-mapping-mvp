const MESSAGES = {
  not_found:
    "הקישור שגוי או שאינו קיים. יש לבדוק את הקישור שנשלח, או לפנות למשרד עורכי הדין לקבלת קישור חדש.",
  expired:
    "תוקף החיבור הנוכחי פג, אך כל התשובות שנשמרו עד כה נשמרו במלואן ולא אבדו. יש להשתמש שוב באותו קישור מקורי שנשלח אליך כדי להמשיך בדיוק מהמקום שבו הפסקת.",
} as const;

export function AccessError({ error }: { error: "not_found" | "expired" }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="max-w-md rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
        <h1 className="text-lg font-semibold text-slate-900">לא ניתן להציג את השאלון</h1>
        <p className="mt-3 text-sm text-slate-600">{MESSAGES[error]}</p>
      </div>
    </div>
  );
}
