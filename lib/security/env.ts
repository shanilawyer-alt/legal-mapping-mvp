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
  /**
   * Gates the pilot-only synthetic-extraction fixture control on the
   * admin Run Analysis form (PILOT_VALIDATION_PLAN.md §6,
   * OPEN_QUESTIONS.md item 25). Must be explicitly set to `"true"` in a
   * deployment for the fixture-tag `<select>` to render at all, and for
   * `runAnalysisAction` to honor a submitted tag — absent, empty, or any
   * other value means disabled, the safe default. Never enable this in
   * a deployment serving real clients.
   */
  PILOT_SYNTHETIC_MODE_ENABLED: z.enum(["true", "false"]).optional().default("false"),
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

/** True only when PILOT_SYNTHETIC_MODE_ENABLED="true" is explicitly set — false is the safe default. */
export function isPilotSyntheticModeEnabled(): boolean {
  return getEnv().PILOT_SYNTHETIC_MODE_ENABLED === "true";
}
