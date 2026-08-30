"use client";

import { useActionState } from "react";
import {
  createAssessmentAction,
  type CreateAssessmentState,
} from "@/app/(admin)/admin/create-assessment-action";

const initialState: CreateAssessmentState = {};

export function CreateAssessmentForm() {
  const [state, formAction, pending] = useActionState(createAssessmentAction, initialState);

  return (
    <div className="rounded-lg border border-slate-200 bg-white p-6">
      <h2 className="text-lg font-medium text-slate-900">יצירת מיפוי חדש</h2>
      <form action={formAction} className="mt-4 flex items-end gap-3">
        <div className="flex-1">
          <label htmlFor="legalName" className="block text-sm font-medium text-slate-700">
            שם העסק
          </label>
          <input
            id="legalName"
            name="legalName"
            required
            className="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-slate-500 focus:outline-none"
          />
        </div>
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {pending ? "יוצר…" : "צור קישור מאובטח"}
        </button>
      </form>

      {state.error ? (
        <p role="alert" className="mt-3 text-sm text-red-600">
          {state.error}
        </p>
      ) : null}

      {state.link ? (
        <div className="mt-4 rounded-md bg-emerald-50 p-3 text-sm text-emerald-900">
          <p>
            נוצר קישור עבור <strong>{state.organizationName}</strong>. הקישור מוצג פעם אחת בלבד
            — יש להעתיק ולשלוח ללקוח/ה כעת:
          </p>
          <code className="mt-2 block break-all rounded bg-white px-2 py-1 text-xs">
            {state.link}
          </code>
        </div>
      ) : null}
    </div>
  );
}
