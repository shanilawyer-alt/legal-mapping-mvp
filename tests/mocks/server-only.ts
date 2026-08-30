// Test-only stub for the "server-only" package. The real package throws
// when imported outside a React Server Component bundling context, which
// includes plain Node — i.e. Vitest. Aliased in vitest.config.ts so
// domain/lib modules that import "server-only" (correctly, for app code)
// can still be unit tested directly.
export {};
