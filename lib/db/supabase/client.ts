import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getEnv } from "@/lib/security/env";

/**
 * Service-role Supabase client. Bypasses RLS by design — only ever import
 * this from server-only code (API routes, server actions, scripts) that
 * has already performed its own authorization check (admin session, or a
 * verified assessment token via domain/assessment/service.ts). Never
 * expose this client, or a value derived from the service-role key, to a
 * client component or a browser-reachable response.
 */
let cached: SupabaseClient | undefined;

export function getServiceRoleClient(): SupabaseClient {
  if (cached) return cached;
  const env = getEnv();
  cached = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
