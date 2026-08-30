// Dummy env values so lib/security/env.ts's Zod validation passes in
// tests. None of these point at a real Supabase project — tests that
// exercise repository logic use the in-memory adapter (lib/db/inMemory.ts),
// not the Supabase-backed one.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "https://test-project.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??= "test-anon-key";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-service-role-key";
process.env.ASSESSMENT_TOKEN_PEPPER ??= "test-pepper-at-least-32-characters-long";
