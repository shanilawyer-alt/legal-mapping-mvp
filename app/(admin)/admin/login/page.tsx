import { LoginForm } from "@/app/(admin)/admin/login/login-form";

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm rounded-lg border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-xl font-semibold text-slate-900">כניסת עורך/ת דין</h1>
        <p className="mt-1 text-sm text-slate-500">
          מערכת מיפוי משפטי — גישה למנהלי המערכת בלבד.
        </p>
        <LoginForm nextPath={next ?? "/admin"} />
      </div>
    </div>
  );
}
