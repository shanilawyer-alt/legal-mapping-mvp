import "server-only";
import { getServiceRoleClient } from "@/lib/db/supabase/client";
import { createSupabaseRepositories } from "@/lib/db/supabase/repositories";
import type { Repositories } from "@/lib/db/repositories";

let cached: Repositories | undefined;

/** The repository set the running app uses (Supabase-backed). */
export function getRepositories(): Repositories {
  if (!cached) cached = createSupabaseRepositories(getServiceRoleClient());
  return cached;
}

export type { Repositories } from "@/lib/db/repositories";
