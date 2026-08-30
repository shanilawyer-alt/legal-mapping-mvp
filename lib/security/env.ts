import { z } from "zod";

/**
 * Server-only environment schema. Importing this file from a client
 * component is a mistake by construction: every value here is either a
 * secret or a server-side URL, and `server-only` makes that a build error.
 */
import "server-only";

const envSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  ASSESSMENT_TOKEN_PEPPER: z
    .string()
    .min(32, "ASSESSMENT_TOKEN_PEPPER must be at least 32 characters"),
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Validates process.env once and caches the result. Throws immediately
 * (fail fast at boot / first server-side use) rather than letting a
 * missing secret surface later as a confusing runtime error.
 */
export function getEnv(): Env {
  if (cached) return cached;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  cached = parsed.data;
  return cached;
}
