"use client";

import { useState } from "react";

type UploadStatus = "idle" | "uploading" | "success" | "error";

export function DocumentUpload({
  token,
  documentType,
  label,
}: {
  token: string;
  documentType: string;
  label: string;
}) {
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [filename, setFilename] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function handleFile(file: File) {
    setStatus("uploading");
    setFilename(file.name);
    setMessage(null);

    const formData = new FormData();
    formData.append("token", token);
    formData.append("documentType", documentType);
    formData.append("file", file);

    try {
      const res = await fetch("/api/documents", { method: "POST", body: formData });
      const body = await res.json();
      if (!res.ok) {
        setStatus("error");
        setMessage(body.message ?? "העלאת הקובץ נכשלה.");
        return;
      }
      setStatus("success");
    } catch {
      setStatus("error");
      setMessage("העלאת הקובץ נכשלה. יש לבדוק את החיבור לרשת.");
    }
  }

  return (
    <div className="mt-3 rounded-md border border-dashed border-slate-300 bg-slate-50 p-3">
      <p className="text-xs text-slate-600">
        לפני ההעלאה: יש להסיר שמות, מספרי זהות, פרטי בנק, מידע רפואי ופרטים אישיים נוספים
        שאינם נחוצים לבדיקה ({label}).
      </p>
      <div className="mt-2 flex items-center gap-3">
        <label className="cursor-pointer rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100">
          בחירת קובץ
          <input
            type="file"
            className="sr-only"
            accept=".pdf,.docx,.jpg,.jpeg,.png,.xlsx,.csv"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
        </label>
        {filename ? <span className="text-xs text-slate-500">{filename}</span> : null}
        {status === "uploading" ? <span className="text-xs text-slate-500">מעלה…</span> : null}
        {status === "success" ? <span className="text-xs text-emerald-600">הועלה בהצלחה</span> : null}
        {status === "error" ? <span className="text-xs text-red-600">{message}</span> : null}
      </div>
    </div>
  );
}
