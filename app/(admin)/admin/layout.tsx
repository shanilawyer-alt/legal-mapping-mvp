import type { ReactNode } from "react";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { signOutAction } from "@/app/(admin)/admin/actions";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const isLoggedIn = Boolean(user);

  return (
    <div className="min-h-screen bg-slate-50">
      {isLoggedIn ? (
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <span className="text-sm font-semibold text-slate-900">מיפוי משפטי — ניהול</span>
          <div className="flex items-center gap-4">
            <span className="text-sm text-slate-500">{user?.email}</span>
            <form action={signOutAction}>
              <button
                type="submit"
                className="text-sm text-slate-500 underline hover:text-slate-900"
              >
                התנתקות
              </button>
            </form>
          </div>
        </header>
      ) : null}
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
