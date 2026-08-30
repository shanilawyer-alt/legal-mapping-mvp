# Open Questions / Proposed Changes

> **Revision note (Phase 1.1)**: items 1, 2, 3, 5, and 6 below were reviewed
> and explicitly decided; each now records the decision rather than posing
> an open question. Item 4's claim of a `--write-db` mode was found to be
> false (no such flag was ever built) and has been corrected. New items 7–10
> were added during Phase 1.1 hardening.

## 1. `questionnaire.csv` and `rule_catalog.csv` were empty stubs — reconstructed from the reference workbook — **APPROVED**

As committed, `questionnaire.csv` contained only the header `ID` (7 bytes) and `rule_catalog.csv` contained only the header `Rule ID` (12 bytes) — no data rows. `legal_mapping_rule_engine_v1.xlsx` contains the same 103 questions and 42 rules under sheets `Master Questionnaire` and `מנוע ניתוח`, with identical column headers to the two stub CSVs.

**What was done**: both CSVs were regenerated as a verbatim, cell-by-cell transcription of those two workbook sheets — no Rule ID, question ID, severity value, condition, or Hebrew wording was altered, reworded, or invented.

**Decision**: approved. The empty CSVs were confirmed to be a packaging defect; the workbook's 103 questions and 42 rules are the intended V1 source material and are to be preserved verbatim.

## 2. Scope of "deterministic branching framework" in Phase 1 — **APPROVED**

Interpreted as the questionnaire's own show/hide and follow-up logic (spec §6), not the legal Rule Engine (spec Phase 3, §23). **Decision**: approved. Full Rule Engine evaluation remains Phase 3.

## 3. Token verification is enforced server-side, not via RLS predicate — **ACCEPTABLE FOR MVP, PENDING REAL SUPABASE TESTING**

A Postgres RLS policy cannot itself hash an incoming claim to compare against a stored hash, so all client-path verification happens in server-side application code using the service-role client; RLS denies the anon/public role outright on every table as defense-in-depth.

**Decision**: acceptable as the MVP architecture, subject to real Supabase integration testing (not yet done — see item 8) confirming public/anon clients genuinely have no direct database access in a live project, the same as verified here against the in-memory test double.

Phase 1.1 extends the same model to the new `assessment_sessions` table (session-token verification), for the same reason.

## 4. No live Supabase project in this build environment — **STILL TRUE; CORRECTED CLAIM**

Migrations, RLS policies, and storage bucket configuration are written as SQL/config but could not be applied against a real Supabase project from this sandbox (no credentials, no network egress to supabase.com). See item 8 for what was and wasn't verified in Phase 1.1, and for exact next steps.

**Correction**: a previous version of this document said "CSV import scripts support a `--write-db` mode but it is untested against a live database." That was false — no such flag was ever implemented in `scripts/import-csv.ts`. There is no code path anywhere that writes CSV data into Postgres. Per your explicit instruction, this will not be built now, only in the phase that actually needs it.

## 5. Client OTP/email verification (spec §2.1, described as "optional") — **DEFERRED, CONFIRMED**

**Decision**: remains deferred. Phase 1/1.1 implement only the token-exchange-to-session mechanism (§4 of `IMPLEMENTATION_PLAN.md`).

## 6. Retention period default — **CLARIFIED**

Spec §17 requires "configurable retention (do not hard-code a legal period)." `retention_days` is nullable, with no automatic deletion job.

**Decision/clarification**: `retention_days = null` must be read as **"retention policy not yet configured"**, not as an intentional "retain indefinitely" choice. This is now stated explicitly in `lib/db/types.ts` and the migration comment. No behavior changed (deletion was and remains a manual admin action either way) — only the documented meaning of `null` was corrected, since a future retention-enforcement feature must not treat an unconfigured assessment as "intentionally permanent."

## 7. Server-side file-signature verification has a known depth limit

Phase 1.1 added `lib/security/fileSignature.ts`, which sniffs actual file content rather than trusting the browser-supplied MIME type. It reliably distinguishes PDF/PNG/JPEG/ZIP-based-container/plain-text by magic bytes. **Limitation**: DOCX and XLSX are both ZIP (OOXML) containers with the same outer signature; this module confirms an upload is a genuine ZIP archive (which already stops the "rename any file to .docx" attack) but does not inspect the ZIP's internal entries to confirm it's specifically a Word document vs. an Excel workbook vs. some other ZIP renamed to either extension. Deeper OOXML content-type verification (checking `[Content_Types].xml` or specific internal entry names) is a reasonable future hardening step, not built here. Flag if this depth is insufficient before real client documents are handled.

## 8. Real Supabase verification — exact status and next steps

**What this sandbox can and can't do**: the Docker daemon needed for `supabase start` (a full local Supabase stack: Postgres + GoTrue + PostgREST + Storage + Realtime) is installed but not running here (`docker ps` fails — no socket), and there is no network egress to supabase.com or any external Supabase project (outbound requests are blocked by the environment's proxy). Plain PostgreSQL 16 **is** installed and was used for a best-effort, clearly-partial check (see below) — no credentials for any real external Supabase project were invented or guessed, per your explicit instruction.

**What was actually verified this way**: the 3 migration files apply cleanly, in order, to a real PostgreSQL 16 database, against a minimal hand-written local stand-in for Supabase's `auth.users` table, `auth.uid()` function, and `storage.buckets` table (needed only because the migrations reference them; this stand-in was never committed to the repo — it existed only in a throwaway local database, created and dropped in this session). This confirms:
- the SQL is syntactically valid and structurally sound (12 tables, 6 enum types, triggers, indexes, foreign keys, and RLS policy syntax all applied without error);
- RLS is enabled on every table that should have it;
- **the RLS policy logic itself behaves correctly**, not just "is enabled" — tested behaviorally, not just inspected: a non-superuser role with table-level `GRANT`s but no matching `admin_profiles` row got 0 rows back on `SELECT` and an explicit `new row violates row-level security policy` error on `INSERT`; the same role, with a session variable made to stand in for `auth.uid()` matching a real `admin_profiles.id`, could then read and write; and reverting to a non-matching id blocked it again. This is a real (if partial) confirmation that the `exists (select 1 from admin_profiles where id = auth.uid())` predicate every policy uses actually does what it's meant to.

**What this does NOT verify, and genuinely cannot without a real Supabase project**:
- That `auth.uid()` behaves identically to Supabase's real implementation under a real authenticated session.
- That PostgREST actually enforces these RLS policies for the `anon` and `authenticated` roles the way the app assumes (this sandbox's stand-in is not PostgREST).
- That the storage bucket policy (`assessment-documents`, `public: false`) behaves as expected under Supabase Storage's actual access-control enforcement.
- That the service-role key genuinely bypasses RLS in a real project the way the design assumes (this is standard, documented Supabase behavior, but has not been exercised here).
- End-to-end behavior of the token-exchange flow, session cookie, or document upload pipeline against a real database and real HTTP requests.

**To complete real verification, you (or a session with the right access) need one of**:
1. **A machine/environment with a working Docker daemon**: run `supabase init` (if not already) → `supabase start` → `supabase db push` (applies all 3 migrations for real) → set `.env.local` from the CLI's printed local URL/keys → run the app against it → re-run `tests/*.integration.test.ts` pointed at the real API instead of the mocked repositories (would need a small test-mode switch to use the real Supabase-backed repositories instead of `vi.mock`).
2. **An existing external Supabase project**: provide its project URL, anon key, service-role key, and a value for `ASSESSMENT_TOKEN_PEPPER` (see `.env.example`) as real environment variables (never pasted into chat/committed) → run `supabase link` + `supabase db push` against it → same as above.

Neither credentials nor a fabricated "it probably works" claim were substituted for this — it is left as a genuinely open item.

## 9. Session lifetime (24 hours) is a judgment call, not a spec requirement

Phase 1.1's session token is capped at 24 hours (and can never outlive its parent assessment token). Nothing in the prompts specifies this number. It was chosen to balance security (shorter is better — less time a stolen cookie is useful) against usability (a client filling out a ~10–15 minute questionnaire, possibly with a pause, shouldn't be forced to re-open their original link mid-session). Re-opening the original link at any time mints a fresh session at no cost to the client (the underlying assessment token and any saved answers are unaffected). Flag if a different value is wanted.

## 10. No admin document viewer exists

`DocumentStore.getSignedDownloadUrl()` is implemented and would work, but nothing in the admin app calls it — there is currently no way for an attorney/admin to view or download a document a client uploaded. This was true in Phase 1 and remains true after Phase 1.1 (out of scope for this hardening pass; it's a UI feature, not a security fix).
