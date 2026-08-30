# Implementation Plan — Legal Mapping MVP

## 1. Source data summary

All seven CSVs plus the reference Excel workbook (`data/reference/legal_mapping_rule_engine_v1.xlsx`) were read in full before any code was written.

| File | Rows (excl. header) | Notes |
|---|---|---|
| `data/questionnaire.csv` | 103 | 10 modules (GEN, EMP, PAY, TIME, SOC, HR, TERM, LIT, FR, PRIV). See §2 on reconstruction. |
| `data/rule_catalog.csv` | 42 | Rule IDs `R-EMP-*`, `R-TIME-*`, `R-SOC-*`, `R-PAY-*`, `R-TERM-*`, `R-HR-*`, `R-LIT-*`, `R-PRIV-*`, `R-CAM-*`, `R-BIO-*`, `R-MON-*`, `R-EMAIL-*`, `R-OFF-*`, `R-RET-*`, `R-INC-*`, `R-DPO-*`. See §2. |
| `data/freelancer_screening_model.csv` | 14 | Weighted screening indicators (FR-* question IDs), directional (+/-) points. |
| `data/exposure_factors.csv` | 23 | Scoring methodology dimensions (base severity, scope, duration, systemic, dispute) — matches §12 of the spec exactly. |
| `data/document_analysis_matrix.csv` | 8 | DOC-01..DOC-08, document type → extraction fields → linked question IDs. |
| `data/report_structure.csv` | 12 | Report field layer (Executive/Finding/Commercial/Privacy/Freelancer) × client vs. professional output. |
| `data/legal_sources.csv` | 14 | Legal source registry: topic, source, principle, URL, status/update date. |

Question ID prefixes and counts: GEN 12, EMP 7, PAY 5, TIME 16, SOC 8, HR 4, TERM 7, LIT 2, FR 14, PRIV 28 = 103, matching the "103 שאלות מאסטר" total stated in the workbook's own overview sheet.

## 2. Data-integrity finding (see OPEN_QUESTIONS.md #1)

`questionnaire.csv` and `rule_catalog.csv`, as committed to the repository, contained **only their header row** (e.g. `questionnaire.csv` was 7 bytes: `ID` and a trailing newline). The underlying data exists verbatim in the accompanying reference workbook, on sheets `Master Questionnaire` (103 questions, 12 columns, identical header labels) and `מנוע ניתוח` (42 rules, 17 columns, identical header labels, "Rule Catalog V1" title row).

Per constraint #5 ("do not alter legal Rule IDs, severity values, questionnaire IDs, or Hebrew client wording without explicitly documenting a proposed change"), this is documented as a proposed change rather than a silent edit:

- The two CSVs were regenerated **verbatim** from the workbook sheets (no wording, ID, severity, or logic changes — a byte-for-byte transcription of every cell, including all Hebrew text, punctuation, and quote characters).
- All 103 question IDs and all 42 rule IDs, plus every cross-reference between them (rule "קלטים"/inputs listing question IDs, questionnaire "מתי מוצג" triggers), were checked for internal consistency (§9 below).
- The two files were relocated from repo root to `data/`, alongside the other five CSVs and the reference workbook, matching both the README's instruction ("Place the CSV files under `/data`") and the suggested repository structure in the spec (§4).

## 3. Architecture

- **Framework**: Next.js (App Router), TypeScript strict mode, React 18+.
- **Database**: PostgreSQL via Supabase, plain SQL migrations under `supabase/migrations/`, Row Level Security on every table.
- **Auth**: Supabase Auth (email/password) for attorney/admin accounts only. Client respondents never get a Supabase Auth identity — they use the token flow (§4).
- **Validation**: Zod schemas for every CSV row shape, every API request body, and environment variables at boot.
- **Storage**: Supabase Storage, private bucket, abstracted behind a `DocumentStore` interface (`/lib/storage`) so the backing provider can change without touching callers.
- **AI abstraction**: A `FactExtractor` provider interface is defined (`/lib/ai`) for later phases but is **not wired to the document pipeline in Phase 1** — no document bytes or extracted text are sent anywhere. This satisfies the "do not transmit documents to an AI model yet" constraint literally: the interface exists (so Phase 4 doesn't need a redesign) but has zero callers.
- **Testing**: Vitest for unit tests (CSV validation, branching evaluator, token isolation). No live Supabase instance is available in this build environment, so DB-touching logic is tested through an in-memory implementation of the same repository interfaces the real Supabase adapter implements (a hexagonal/ports-and-adapters seam) — this is also good practice independent of the sandbox constraint.

### Repository layout (matches spec §4)

```
/app
  /(public)/assessment/[token]      client questionnaire
  /(admin)/admin                    admin dashboard (auth-gated)
  /(admin)/admin/login
  /(admin)/admin/assessments/[id]
  /api/assessments                  create assessment, issue token
  /api/assessments/token/[token]    token-authenticated read/write of one assessment
  /api/documents                    upload/list (private, signed URLs only)
/components/{assessment,admin,findings,documents}
/domain
  /questionnaire   loading, typing, section grouping
  /branching       condition parser + evaluator (no eval())
  /rules           typed rule-condition parser (reuses branching grammar), NOT evaluated yet
  /documents       DocumentStore interface + types
  /reports         (stub, Phase 6)
/lib
  /ai              provider interface, no implementation wired to documents yet
  /db              Supabase server client, repository interfaces + Supabase adapters + in-memory test adapters
  /security        token hashing, env validation, security headers
  /audit           audit_events writer
/data              the 7 CSVs + reference workbook (source of truth, read-only at runtime)
/scripts           import-and-validate CSVs
/tests             vitest unit tests
/supabase/migrations
```

## 4. Secure token-based assessment access

- On assessment creation, the server generates 32 random bytes (`crypto.randomBytes`), base64url-encodes them as the client-facing token, and stores only `sha256(token)` in `assessments.secure_token_hash` plus `token_expires_at`.
- The public route is `/(public)/assessment/[token]`. Every server action/API call under it re-hashes the supplied token and does a constant-time-safe equality lookup (`WHERE secure_token_hash = $1 AND token_expires_at > now()`), never a token-prefix or partial match.
- Every table reachable from the client path (`answers`, `documents`) is scoped by `assessment_id`; the API layer additionally re-derives `assessment_id` from the verified token on every request rather than trusting a client-supplied `assessment_id`, so a client cannot swap IDs in a request body to read another assessment.
- RLS: client-side (anon-key) access is denied by default on all tables. All questionnaire read/write for the public flow goes through server-side API routes using the service role, after token verification — the anon key never talks to Postgres directly for assessment data. This is stricter than "RLS keyed on token" because raw tokens are never in the database to compare against inside a policy (only hashes are stored, and RLS predicates can't easily hash a claim), so token verification is enforced in the trusted server layer while RLS provides defense-in-depth by blocking the anon/public role entirely.
- Unit tests (Task 12) simulate two assessments and assert that assessment B's token can never read or write assessment A's answers/documents through the service functions.

## 5. Deterministic branching framework (Phase 1 scope)

FIRST_PROMPT_FOR_CLAUDE_CODE.md lists "deterministic branching framework" as a Phase 1 deliverable, distinct from "Rule Engine" tests. Read together with MASTER_BUILD_SPEC.md (where the Rule Engine is explicitly Phase 3, §23), this is interpreted as: **the questionnaire's own trigger/visibility logic** (spec §6 — `GEN-06 > 0` opens freelancers, etc.), not full rule evaluation. See OPEN_QUESTIONS.md #2.

All 96 conditional question triggers in `questionnaire.csv` were checked against a grammar:

```
condition   := clause (' או ' clause)*        // Hebrew "or"
clause      := QUESTION_ID op value
op          := '=' | '≠' | '>'
value       := token ('/' token)*              // '/' = one-of for equality
```

95 of 96 match this grammar exactly. The one exception (`TIME-07 כולל שעות נוספות גלובליות`, "includes X") appears only inside `rule_catalog.csv` conditions (not as a question-visibility trigger), so it does not block the questionnaire branching framework; a `כולל`/"includes" operator is included in the shared evaluator for forward compatibility with the Rule Engine phase, and is unit-tested, but no questionnaire trigger currently needs it.

Implementation: a small recursive-descent parser (`/domain/branching/parser.ts`) turns each trigger string into a typed AST once at CSV-import time (not per-render), and a pure evaluator function (`/domain/branching/evaluate.ts`) walks the AST against the current `Record<questionId, answerValue>`. No `eval`, `new Function`, or template-based code generation is used anywhere.

## 6. Risk scoring, freelancer screening, Rule Engine

Not implemented in Phase 1 (spec Phase 3). The condition-parser grammar above is written generically enough to also parse `rule_catalog.csv`'s `AND`/`≠`/`=`/`>` conditions later without a rewrite, but no rule is evaluated, no `rule_evaluations`/`findings` rows are written, and no score is computed in this phase. The `rule_catalog.csv` and `exposure_factors.csv` data is imported and validated (schema + referential integrity to question IDs) so Phase 3 can start from validated data, per FIRST_PROMPT's "CSV import/validation scripts" deliverable, which does not restrict itself to only the two CSVs needed for the questionnaire.

## 7. Document storage abstraction (no AI transmission)

- `DocumentStore` interface: `upload(assessmentId, file) -> {storagePath, sha256}`, `getSignedDownloadUrl(storagePath, ttl)`, `delete(storagePath)`.
- Supabase Storage adapter uses a private bucket; the bucket is never public; all reads go through short-lived signed URLs generated server-side.
- Pre-upload, the public UI shows the Hebrew redaction notice required by spec §7 before the file picker is enabled.
- No document content, filename-derived PII, or extracted text is logged. Only `document_id`, `sha256`, `mime_type`, `size_bytes`, and `upload_status` appear in audit events.
- `document_extractions` table and the `FactExtractor` interface are scaffolded (types + Zod schemas) but there is no code path that calls an AI provider with document content — Phase 1 acceptance criteria explicitly forbid it.

## 8. Security baseline

- `.env.example` documents required variables; `/lib/security/env.ts` validates them with Zod at process start and throws on missing/malformed values rather than falling back silently.
- Security headers (CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`) set in `next.config` / middleware.
- `secure_token_hash` — never the raw token — is the only thing persisted; raw tokens exist only in the URL and in the response body returned once at creation time.
- Admin routes (`/admin/**`) are gated by middleware that checks a valid Supabase session and redirects to `/admin/login` otherwise.
- Secrets are read only from environment variables server-side; nothing under `/lib/db` or the service-role key is imported into any client component.
- Synthetic data only — no fixture contains real personal data. Fixtures for the four scenarios in spec §22 (A–D) are added as seed/test data, all synthetic.

## 9. CSV import/validation scripts

`/scripts/import-csv.ts` (run via `tsx`) for each of the 7 files:
1. Parses with a strict Zod row schema matching each CSV's actual header labels (Hebrew headers, preserved verbatim).
2. Validates uniqueness of the ID column (`ID` for questionnaire, `Rule ID` for rule_catalog, `ID` for document_analysis_matrix).
3. Cross-reference checks:
   - Every question ID referenced inside a rule's "קלטים" (inputs) column or a trigger's "מתי מוצג" column exists in `questionnaire.csv`.
   - Every `document_analysis_matrix.csv` "שאלות מקושרות" (linked questions) reference resolves to a real question ID.
   - Every branching trigger parses under the grammar in §5, or is explicitly reported (not silently dropped) if it doesn't.
4. Writes validated JSON snapshots the app loads at build/boot time (`/data/generated/*.json`, gitignored, regenerated by the script) — the running app never re-parses raw CSV at request time.
5. A `--write-db` flag additionally upserts the same data into Postgres via the service-role Supabase client, for admin-side reference (e.g. displaying legal sources); this is optional and not required for the questionnaire UI to function, since Phase 1 has no live Supabase project connected in this build environment.

The same validation logic (schema + referential integrity) is unit tested directly against the real `data/*.csv` files, so the tests double as a live-data integrity check.

## 10. What is explicitly out of scope for Phase 1

Per FIRST_PROMPT_FOR_CLAUDE_CODE.md: everything after the listed Phase 1 items — autosave/save-and-return wiring beyond a basic implementation, full submission + admin viewer, Rule Engine evaluation, AI document extraction, cross-checks, lawyer review screen, PDF report generation, E2E tests. These map to spec Phases 2–7 and are intentionally not built now.
