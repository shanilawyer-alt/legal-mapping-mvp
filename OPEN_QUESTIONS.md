# Open Questions / Proposed Changes

## 1. `questionnaire.csv` and `rule_catalog.csv` were empty stubs — reconstructed from the reference workbook (PROPOSED CHANGE, needs attorney confirmation)

As committed, `questionnaire.csv` contained only the header `ID` (7 bytes) and `rule_catalog.csv` contained only the header `Rule ID` (12 bytes) — no data rows. `legal_mapping_rule_engine_v1.xlsx` (referenced by the README as "the source Excel workbook for human reference") contains the same 103 questions and 42 rules under sheets `Master Questionnaire` and `מנוע ניתוח`, with identical column headers to the two stub CSVs.

**What was done**: both CSVs were regenerated as a verbatim, cell-by-cell transcription of those two workbook sheets — no Rule ID, question ID, severity value, condition, or Hebrew wording was altered, reworded, or invented. The files now live at `data/questionnaire.csv` and `data/rule_catalog.csv`.

**Why this needs sign-off rather than being a silent fix**: constraint #5 in the handoff prompt explicitly prohibits altering these values without documenting a proposed change, and technically the CSV *was* the stated source of truth even though it was empty — the workbook is described only as "for human reference." This plan takes the position that an empty authoritative file is a packaging defect, not an intentional narrowing of scope, and that the workbook (visibly the origin of both files, down to matching headers) is the correct recovery source. Please confirm this is correct, or supply corrected CSVs if the workbook itself is stale relative to some newer edit.

**Verification performed**: row counts match the workbook's own summary tab (103 questions total, broken down by module); all 42 rule IDs are unique; all 103 question IDs are unique; cross-references between the two files and `document_analysis_matrix.csv` were checked for dangling IDs (see `scripts/import-csv.ts` output / `tests/csv-validation.test.ts`).

## 2. Scope of "deterministic branching framework" in Phase 1

FIRST_PROMPT_FOR_CLAUDE_CODE.md lists "deterministic branching framework" as a Phase 1 item. MASTER_BUILD_SPEC.md §23 places the full deterministic **Rule Engine** in Phase 3, after client pilot (Phase 2) and before document extraction (Phase 4). Building 42 rules' worth of legal-condition evaluation, scoring, and `rule_evaluations`/`findings` persistence now would front-run that sequencing and the spec's instruction to "implement deterministic tests before broad AI functionality" in the order given.

**Interpretation taken**: "branching framework" = the questionnaire's own show/hide and follow-up logic (spec §6: `GEN-06 > 0` opens the freelancer module, etc.) — i.e., the mechanism that decides which of the 103 questions are shown, not the Rule Engine that turns answers into legal findings. The condition-parsing grammar is written generically enough that Phase 3 can reuse it directly against `rule_catalog.csv` without rework, but no rule is evaluated and no finding/score is produced in this phase. Flagging this in case the intent was to pull rule evaluation forward into Phase 1.

## 3. Token verification is enforced server-side, not via RLS predicate

Spec §5 says "never store raw secure tokens" (only `secure_token_hash`), and §17/§21 both require verified RLS and token isolation. A Postgres RLS policy cannot itself hash an incoming claim to compare against a stored hash, so pure "RLS keyed on the token" isn't achievable without either (a) storing the raw token (rejected by §5) or (b) passing a pre-hashed value as a session claim that RLS then compares — which is possible but adds a second, parallel auth mechanism (Postgres session variables set per-request) alongside Supabase Auth.

**Decision taken**: the public/client path never talks to Postgres with the anon key at all. All token verification happens in a server-only service function using the service-role client, after which the service-role client (which bypasses RLS by design) reads/writes only the rows for the `assessment_id` resolved from that verified token. RLS is still enabled and denies the anon/public role outright on every table, as defense-in-depth against any future code path that might use the anon key. Token-isolation is proven by unit tests at the service-function boundary, not by a Postgres policy. Flagging in case a DB-level (not just application-level) isolation proof is required for this MVP.

## 4. No live Supabase project in this build environment

Migrations, RLS policies, and storage bucket configuration are written as SQL/config but could not be applied against a real Supabase project from this sandbox (no credentials, no network target). CSV import scripts support a `--write-db` mode but it is untested against a live database. Recommend running `supabase db push` and the import script against a real (still synthetic-data) project before Phase 2 starts, and adding that as a CI step.

## 5. Client OTP/email verification (spec §2.1, described as "optional") — not built in Phase 1

Spec text: "secure expiring assessment link with a random token, **optional** OTP/email verification." Given it's explicitly optional and no default is specified, Phase 1 implements only the token-link mechanism (already a random 256-bit token behind a hash, with expiry). OTP/email step is left as a documented extension point rather than guessed at, since adding it wrong (e.g., picking SMS vs. email, picking a provider) would be harder to undo than adding it later. Flag if this should be required now.

## 6. Retention period default

Spec §17 requires "configurable retention (do not hard-code a legal period)." A `retention_days` (nullable = indefinite until an admin sets it) column/config value is added, defaulting to `null`/unset, with no automatic deletion job in Phase 1 (deletion is manual, via the existing "admin delete/archive" action). Confirm this default (no automatic expiry until an attorney configures one) is the intended safe default, versus requiring a mandatory value at organization-creation time.
