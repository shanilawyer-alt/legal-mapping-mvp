import Link from "next/link";

export default function HomePage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="max-w-md text-center">
        <h1 className="text-2xl font-semibold text-slate-900">מיפוי משפטי לעסקים</h1>
        <p className="mt-3 text-sm text-slate-600">
          כלי מיפוי סיכונים משפטיים בליווי עורך/ת דין, בתחומי דיני עבודה, פרילנסרים ופרטיות
          במקום העבודה. גישה לשאלון מתבצעת באמצעות קישור מאובטח שנשלח על ידי המשרד.
        </p>
        <Link
          href="/admin/login"
          className="mt-6 inline-block rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
        >
          כניסת עורך/ת דין
        </Link>
      </div>
    </div>
  );
}
