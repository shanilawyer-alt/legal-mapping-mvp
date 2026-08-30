import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getEnv } from "@/lib/security/env";

/**
 * Anon-key Supabase client bound to the current request's cookies, used
 * for admin authentication (sign in/out, reading the current session).
 * This is deliberately NOT the service-role client — admin data access
 * beyond auth itself goes through lib/db (service role) after the caller
 * has already been confirmed authenticated.
 */
export async function createSupabaseServerClient() {
  const cookieStore = await cookies();
  const env = getEnv();

  return createServerClient(env.NEXT_PUBLIC_SUPABASE_URL, env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Called from a Server Component render, where cookies can't be
          // mutated. Session refresh happens in middleware instead.
        }
      },
    },
  });
}
