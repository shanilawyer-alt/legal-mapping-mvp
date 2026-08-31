# Implementation Plan — Legal Mapping MVP

> **Revision note (Phase 1.1)**: this document was corrected after a Phase 1
> review found it described several files/components that were never
> actually built (`/lib/ai`, `/domain/rules`, `/lib/audit`, a `--write-db`
> CSV-import flag, several routes). Section 3's repository layout and §9
> now describe the actual as-built system, not an earlier intention. Where
> something was aspirational and never implemented, it has been removed
> rather than left to mislead a future reader. Section 11 documents the
> Phase 1.1 hardening changes.
>
> **Revision note (Phase 2)**: Section 3's repository layout and the "what
> does not exist" paragraph are updated again below — the admin assessment
> detail view and the submit API route this document previously listed as
> not built now exist. Section 12 documents everything Phase 2 added. The
> Rule Engine/AI/findings items are still correctly listed as not built —
> Phase 2 was scoped to the client pilot flow only, per your instruction.

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

## 2. Data-integrity finding — resolved, approved

`questionnaire.csv` and `rule_catalog.csv`, as originally committed to the repository, contained **only their header row** (e.g. `questionnaire.csv` was 7 bytes: `ID` and a trailing newline). The underlying data exists verbatim in the accompanying reference workbook, on sheets `Master Questionnaire` (103 questions, 12 columns, identical header labels) and `מנוע ניתוח` (42 rules, 17 columns, identical header labels, "Rule Catalog V1" title row).

Both CSVs were regenerated as a verbatim, cell-by-cell transcription of those two workbook sheets — no Rule ID, question ID, severity value, condition, or Hebrew wording was altered, reworded, or invented. **This reconstruction has been explicitly approved**: the empty CSVs were confirmed to be a packaging defect, and the workbook's 103 questions and 42 rules are the intended V1 source material, to be preserved verbatim. The files live at `data/questionnaire.csv` and `data/rule_catalog.csv`.

Verification performed: row counts match the workbook's own summary tab; all 42 rule IDs are unique; all 103 question IDs are unique; cross-references between the two files and `document_analysis_matrix.csv` were checked for dangling IDs (`scripts/import-csv.ts` / `tests/csv-validation.test.ts`).

## 3. Architecture

- **Framework**: Next.js 16 (App Router), TypeScript strict mode, React 19.
- **Database**: PostgreSQL via Supabase, plain SQL migrations under `supabase/migrations/`, Row Level Security on every table. **Not yet applied to any live database** — see §10.
- **Auth**: Supabase Auth (email/password) for attorney/admin accounts only. Client respondents never get a Supabase Auth identity — they use the token/session flow (§4).
- **Validation**: Zod schemas for every CSV row shape, every API request body, and environment variables at boot.
- **Storage**: Supabase Storage, private bucket, abstracted behind a `DocumentStore` interface (`lib/storage/`) so the backing provider can change without touching callers.
- **AI**: no AI provider integration exists anywhere in this codebase. No document content or extracted text is sent anywhere. This is not an abstraction waiting to be wired up — nothing AI-related has been built yet, deliberately (spec Phase 4).
- **Testing**: Vitest. Unit tests cover CSV validation, the branching parser/evaluator, token/session generation and isolation, file-signature sniffing, and document-upload validation. Integration-level tests exercise the actual public API route handlers (`tests/api-*.integration.test.ts`) with `lib/db`/`lib/storage` mocked to in-memory implementations — no live Supabase project is reachable from this build environment (§10).

### Actual repository layout (as built, through Phase 2)

```
/app
  /(public)/assessment/page.tsx            questionnaire UI — reads the session cookie, no token in its URL; renders the locked/submitted view server-side for a non-DRAFT assessment (Phase 2)
  /(public)/assessment/assessment-shell.tsx  client-side form/autosave/branching/review-screen/submit/locked-and-expired notices (Phase 2)
  /(public)/assessment/[token]/route.ts    token-exchange endpoint only (Phase 1.1) — GET, sets the session cookie, redirects
  /(admin)/admin                           admin dashboard (auth-gated): create-assessment form + full assessment list (Phase 2)
  /(admin)/admin/login
  /(admin)/admin/assessments/[id]          admin assessment detail: profile/answers/documents/audit sections, reopen action (Phase 2)
  /(admin)/admin/documents/[id]/download   admin-only: issues a fresh signed URL and redirects (Phase 2)
  /api/assessments/answers                 session-scoped answer read/write, server-side value validation (Phase 2)
  /api/assessments/submit                  session-scoped final submission (Phase 2)
  /api/documents                           session-scoped document upload
/components
  /assessment    question-field, document-upload, access-error, submitted-view (Phase 2)
  /admin         confirm-submit-button (Phase 2)
/domain
  /questionnaire   loading, typing, section grouping; effective.ts (stale-answer policy, Phase 2); validate.ts (answer-value validation, Phase 2)
  /branching       condition parser + evaluator (no eval()) — questionnaire trigger logic only
  /csv             Zod row schemas + generic CSV parser + referential-integrity checks, for all 7 CSVs
  /assessment      assessment-token issuance/resolution (service.ts) + session issuance/resolution (session.ts) + submission.ts (submit/reopen, Phase 2)
  /documents       upload orchestration (validation, hashing, storage call, audit) + admin delete/signed-URL-issuance (Phase 2)
  /admin           dashboard.ts (per-assessment summary assembly), statusLabels.ts (Phase 2)
/lib
  /db          repository interfaces (ports) + Supabase adapter + in-memory test adapter
  /security    token/session generation+hashing, file-signature sniffing, zipEntries.ts (ZIP central-directory reader, Phase 2), env validation, session-cookie config
  /storage     DocumentStore interface + Supabase Storage adapter + upload validation (deep OOXML entry check, Phase 2)
  /supabase    Supabase server client + auth middleware helpers + getAdminUserId() (Phase 2)
/data          the 7 CSVs + reference workbook (source of truth, read-only at runtime)
/scripts       import-and-validate CSVs (no database-writing mode exists — see §9)
/tests         vitest unit + integration tests
/supabase/migrations
```

**What still does not exist**: `/lib/ai`, `/domain/rules`, `/lib/audit` as a standalone module (audit writing is inline via `AuditRepository` in `lib/db`), `/components/findings`, any legal-findings/Rule-Engine output on the admin detail page. None of these are required by Phase 2; build them only in Phase 3, per your instruction. (`/app/(admin)/admin/assessments/[id]` and a submit API route — both listed as not-yet-built in the Phase 1.1 revision of this document — now exist; see §12.)

## 4. Assessment access: token-exchange to a session (Phase 1.1)

This section describes the hardened design; see §11 for why it changed from the original Phase 1 version.

- **Assessment token** (issued once, by an admin): `crypto.randomBytes(32)` → base64url, 256 bits of entropy. Only `HMAC-SHA256(pepper, token)` is stored, in `assessments.secure_token_hash`. The raw token is shown to the admin exactly once and is meant to be sent to the client as a link; it is never persisted anywhere.
- **Token exchange**: the client's first visit to `/assessment/<token>` hits `app/(public)/assessment/[token]/route.ts`, a GET-only Route Handler (not a page). It resolves the token, and on success mints a brand-new, independently-random **session token**, stores only its hash in `assessment_sessions.session_token_hash`, sets it as an `HttpOnly; Secure; SameSite=Lax` cookie (`assessment_session`), and redirects (HTTP redirect, not a client-side navigation) to the clean URL `/assessment` — no token, no query string identifying the assessment. On failure it redirects to `/assessment?error=not_found` or `?error=expired`.
- **Ongoing session**: every subsequent page load of `/assessment`, and every call to `/api/assessments/answers` or `/api/documents`, reads the `assessment_session` cookie server-side (`request.cookies.get(...)` in Route Handlers, `cookies()` from `next/headers` in the page). The cookie is `HttpOnly`, so client-side JavaScript cannot read or exfiltrate it; the browser attaches it automatically to same-origin requests.
- **Session lifetime**: capped at 24 hours, and additionally can never outlive its parent assessment token's own expiry (`sessionExpiresAt = min(now + 24h, assessment.tokenExpiresAt)`). If a session expires mid-questionnaire, revisiting the original link mints a fresh one — the underlying assessment token (and any partially-completed answers, which are keyed by `assessment_id`, not by session) is unaffected.
- **Isolation**: every session-scoped operation (`getAnswersForSession`, `submitAnswerForSession`, `uploadDocumentForSession`) takes only a raw session token as input and derives `assessmentId` from it server-side — never from a client-supplied field. `tests/session-isolation.test.ts` and `tests/api-*.integration.test.ts` prove this directly, including a test that a malicious request body claiming a different `assessmentId` has no effect.
- **RLS**: unchanged in spirit from the original design — client-side (anon-key) access is denied by default on every table, including the new `assessment_sessions`. All public-flow reads/writes go through server-side code using the service-role client, after token or session verification in application code. RLS remains defense-in-depth, not the primary enforcement mechanism, for the same reason as before (§ "Token verification" in `OPEN_QUESTIONS.md`): a Postgres policy cannot itself hash an incoming claim to compare against a stored hash without either storing raw credentials or adding a parallel session-claim mechanism.

## 5. Deterministic branching framework (Phase 1 scope)

FIRST_PROMPT_FOR_CLAUDE_CODE.md lists "deterministic branching framework" as a Phase 1 deliverable, distinct from "Rule Engine" tests. Read together with MASTER_BUILD_SPEC.md (where the Rule Engine is explicitly Phase 3, §23), this is interpreted as: **the questionnaire's own trigger/visibility logic** (spec §6 — `GEN-06 > 0` opens freelancers, etc.), not full rule evaluation. This interpretation has been explicitly approved; full Rule Engine evaluation remains Phase 3.

All 96 conditional question triggers in `questionnaire.csv` were checked against a grammar:

```
condition   := clause (' או ' clause)*        // Hebrew "or"
clause      := QUESTION_ID op value
op          := '=' | '≠' | '>'
value       := token ('/' token)*              // '/' = one-of for equality
```

95 of 96 match this grammar exactly. The one exception (`TIME-07 כולל שעות נוספות גלובליות`, "includes X") appears only inside `rule_catalog.csv` conditions (not as a question-visibility trigger), so it does not block the questionnaire branching framework; a `כולל`/"includes" operator is included in the shared evaluator and is unit-tested, but no questionnaire trigger currently needs it.

Implementation: a small recursive-descent parser (`domain/branching/parser.ts`) turns each trigger string into a typed AST once at CSV-import time (not per-render), and a pure evaluator function (`domain/branching/evaluate.ts`) walks the AST against the current `Record<questionId, answerValue>`. No `eval`, `new Function`, or template-based code generation is used anywhere.

## 6. Risk scoring, freelancer screening, Rule Engine

Not implemented in Phase 1 or 1.1 (spec Phase 3). No rule is evaluated, no `rule_evaluations`/`findings` row is ever written, and no score is computed. `rule_catalog.csv` and `exposure_factors.csv` are imported and schema/referential-integrity validated only, so Phase 3 can start from validated data; nothing beyond validation exists for them yet, per your explicit instruction not to build `/domain/rules` or any other Rule-Engine component ahead of the phase that needs it.

## 7. Document storage abstraction — implemented vs. still a stub

- **Implemented, end to end**: client selects a file → Hebrew redaction notice (spec §7) → `POST /api/documents` (session-cookie-authenticated) → MIME-type/size validation → **server-side content-signature verification** (Phase 1.1 — see §11; the declared MIME type is cross-checked against the file's actual magic bytes, not trusted alone) → SHA-256 computed server-side → uploaded to a private Supabase Storage bucket → metadata row written to `documents` → audit event (metadata only, never file content).
- **`getSignedDownloadUrl()` and `.delete()`** (Phase 2): now wired into the admin UI — `app/(admin)/admin/documents/[id]/download/route.ts` issues a fresh short-lived signed URL and redirects to it (never exposing the bucket or a raw storage path to the browser); the admin detail page's document-delete action calls `.delete()` plus a DB soft-delete, both audited. See §12.
- **Does not exist**: any AI extraction call. `document_extractions` table exists in the schema (unused) for a future phase; there is no `FactExtractor` interface or any other AI-adjacent code in this codebase.

## 8. Security baseline

- `.env.example` documents required variables; `lib/security/env.ts` validates them with Zod at process start and throws on missing/malformed values rather than falling back silently.
- Security headers (CSP, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`) set in `next.config.ts` / `proxy.ts` (Next.js 16 renamed the `middleware.ts` convention to `proxy.ts` mid-build; functionally the same edge-interception mechanism).
- Neither the assessment token nor the session token is ever persisted in raw form — only `HMAC-SHA256` digests, keyed by a server-side pepper (`ASSESSMENT_TOKEN_PEPPER`).
- Admin routes (`/admin/**`) are gated by `proxy.ts`, which checks a valid Supabase session and redirects to `/admin/login` otherwise.
- Secrets are read only from environment variables server-side; nothing under `lib/db` or the service-role key is imported into any client component.
- Synthetic data only — no fixture contains real personal data.

## 9. CSV import/validation scripts

`scripts/import-csv.ts` (run via `tsx`, and automatically as a `pre*` hook before `dev`/`build`/`typecheck`/`test`) for each of the 7 files:
1. Parses with a strict Zod row schema matching each CSV's actual header labels (Hebrew headers, preserved verbatim).
2. Validates uniqueness of the ID column.
3. Cross-reference checks (every rule input / trigger / linked-question reference resolves to a real ID; every branching trigger parses under the grammar in §5, or is explicitly reported, never silently dropped).
4. Writes validated JSON snapshots the app loads at build/boot time (`data/generated/*.json`, gitignored, regenerated by the script) — the running app never re-parses raw CSV at request time.

**There is no `--write-db` flag or any other code path that writes CSV data into Postgres.** An earlier version of this document described one; it was never built, and per your explicit instruction it should not be added now just because it was once planned — it isn't needed by anything in Phase 1 or 1.1.

The same validation logic (schema + referential integrity) is unit tested directly against the real `data/*.csv` files, so the tests double as a live-data integrity check.

## 10. Real Supabase verification — status

No live Supabase project is reachable from this build/development environment: the Docker daemon needed to run `supabase start` (a local Supabase stack) is not running here, and there is no network egress to supabase.com or any external Supabase project. Migrations were checked against a plain local PostgreSQL 16 instance (available in this sandbox, used and then torn down within this session — nothing from it is committed) with a minimal hand-written stand-in for Supabase's `auth.users`/`auth.uid()`/`storage.buckets`. This confirmed not just that the SQL applies cleanly, but that the RLS policies' actual allow/deny behavior is correct: a non-admin role was blocked from reading/writing, then a role matching a real `admin_profiles` row could read/write, then a non-matching id was blocked again. This is **not** equivalent to real Supabase integration testing (no real GoTrue-issued JWTs, no PostgREST enforcing RLS as the `anon`/`authenticated` roles actually would, no Storage bucket policy enforcement, no end-to-end HTTP test of the app itself). See `OPEN_QUESTIONS.md` item 8 for exact setup steps to complete real verification.

## 11. Phase 1.1 hardening (this revision)

Applied after Phase 1 review, per approved decisions:

- **Token-exchange session flow** (§4): the raw assessment token is now used exactly once, to mint a short-lived session carried in an `HttpOnly`/`Secure`/`SameSite=Lax` cookie. It no longer remains in the browser URL, browser history, or gets resent on every questionnaire/API request. New `assessment_sessions` table (migration `20260830000002`), new `domain/assessment/session.ts`, new `app/(public)/assessment/[token]/route.ts` (replacing what was previously a page at that path).
- **Server-side file-type verification** (§7): `lib/security/fileSignature.ts` sniffs actual file content (magic bytes for PDF/PNG/JPEG/ZIP-based DOCX-XLSX, a not-binary heuristic for CSV) and `lib/storage/validation.ts` rejects any upload whose declared MIME type doesn't match its real content — closing the "rename malware.exe to report.pdf" gap where only the browser-supplied MIME type was checked before. Known limitation: DOCX and XLSX are both ZIP containers and are only verified as "a real ZIP", not distinguished from each other or from an arbitrary renamed ZIP — see `OPEN_QUESTIONS.md`.
- **`safeCompareHash` removed** from `lib/security/token.ts`: it had no call site (every hash lookup goes through an indexed database equality query or, in tests, a `Map`/array lookup — neither is a meaningful timing side-channel vector in this architecture), so per your instruction it was removed rather than wired in without a real justification.
- **`retention_days = null`** is now explicitly documented (in `lib/db/types.ts` and the migration comment) as "not yet configured," not "retain indefinitely." No behavior changed — there was and is no automatic deletion job — only the meaning of the null value was clarified, since the two are easy to conflate and the distinction matters for a future retention-enforcement feature.
- **Integration-level tests** added for the actual `app/api/assessments/answers/route.ts` and `app/api/documents/route.ts` handlers (not reimplementations), covering missing/forged/expired session rejection, cross-assessment isolation, and rejection of a client-supplied `assessmentId` in a request body.
- **Renamed** `generateAssessmentToken`/`hashAssessmentToken` in `lib/security/token.ts` to `generateSecureToken`/`hashSecureToken`, since the same primitive is now used for two credential types (assessment tokens and session tokens); keeping the old, narrower names would itself have become the kind of misleading-naming issue this hardening pass was meant to fix.

## 12. Phase 2 — Client Pilot Flow

Scoped exactly as instructed: the complete client questionnaire/submission flow and the admin-side dashboard/detail views needed to operate it, and nothing from the Rule Engine, AI extraction, cross-check engine, findings, or report generation (all still Phase 3+, untouched). Preserved without alteration throughout: the 103 questionnaire questions, question IDs, Hebrew client wording, 42 Rule IDs, severity values, and every other `data/*.csv` file — verified via `git diff --stat -- data/` staying empty at every step.

- **`assessment_status` gains `SUBMITTED`** (migration `20260830000003_assessment_status_submitted.sql`, `ALTER TYPE ... ADD VALUE ... BEFORE 'ANALYZED'`, additive only). Documented in `OPEN_QUESTIONS.md` item 11 before being implemented, per your instruction — the gap it closes (nothing to correctly transition `status` to on client submission, short of falsely claiming `ANALYZED`) is explained there. Workflow is now `DRAFT → SUBMITTED → ANALYZED → LAWYER_REVIEW → APPROVED → CLIENT_REPORT_RELEASED`.
- **Stale-branching-answer policy** (`domain/questionnaire/effective.ts`, `computeEffectiveAnswers()`): a pure, single-forward-pass function over the questionnaire's own item order, verified programmatically to be a valid dependency order (every trigger condition in the generated 103-item questionnaire references only an earlier question ID — zero exceptions). Produces the "effective" answer set (only currently-visible questions' answers) plus a per-question stale/active/answered status. This is the one and only place "is this a stale answer" is decided, and every downstream consumer (submission validation, the admin detail view) uses it rather than re-deriving the concept. Nothing is ever deleted — stale rows remain in `answers` for audit/history (OPEN_QUESTIONS.md item 18), and are shown, marked, on the admin detail page rather than hidden.
- **Server-side answer-value validation** (`domain/questionnaire/validate.ts`): every write to `POST /api/assessments/answers` is checked against the question's actual `answerType`/`options` from the same generated questionnaire snapshot the UI renders from — not a separately maintained list. A blank/whitespace-only text answer or an empty multi-choice selection is normalized to `null` (a policy call, documented in OPEN_QUESTIONS.md item 19) rather than stored as `""`/`[]`, so "has this been answered" stays a single unambiguous check everywhere it's asked.
- **Submission lifecycle** (`domain/assessment/submission.ts`): `submitAssessmentForSession()` requires every currently-active **core** question to be answered (conditional questions stay optional even when visible — OPEN_QUESTIONS.md item 12), then flips the assessment to `SUBMITTED` and sets `submitted_at`. `assertAssessmentEditable()` (in `domain/assessment/session.ts`, shared by answer writes and document uploads) rejects any further client write with a `locked` error once an assessment leaves `DRAFT`. `reopenAssessment()` is scoped to `SUBMITTED → DRAFT` only (item 16) and is always audited with the acting admin's id.
- **Deep OOXML verification** (`lib/security/zipEntries.ts`, a dependency-free ZIP central-directory reader — no decompression of any entry's content, just names): `lib/storage/validation.ts` now additionally requires `word/document.xml` for a declared DOCX and `xl/workbook.xml` for a declared XLSX, rejecting a well-formed-but-wrong or unparseable ZIP with a distinct `ooxml_mismatch` code. Closes the "arbitrary ZIP renamed to .docx" gap the Phase 1.1 signature check left open (OPEN_QUESTIONS.md item 7) — a remaining, documented limit: it checks for the one entry each format cannot function without, not the full OOXML schema.
- **Client questionnaire UI** (`app/(public)/assessment/assessment-shell.tsx`): three phases — `form` (unchanged section-by-section flow, now with "(שדה חובה)"/"(אופציונלי)" labels driven by `isCore`), `review` (every currently-visible answer, grouped by section, with per-question edit links; blocked from submitting while any required question is unanswered, with that list shown), `confirmation` (`components/assessment/submitted-view.tsx`). A fresh page load of a non-DRAFT assessment renders the same locked/confirmation view server-side (`app/(public)/assessment/page.tsx`), so a reload — or an admin reopen — never shows a stale editable form. A `423`/`410` response from any write switches to a dedicated locked/expired notice; the expired message explicitly states saved answers are not lost and the original link can be reused (spec item 8).
- **Admin dashboard** (`domain/admin/dashboard.ts`, wired into `app/(admin)/admin/page.tsx`): business name, status, created/last-activity dates, required-questions-answered count, employee/freelancer counts (from `GEN-04`/`GEN-06` answers, not the unused `organizations` columns — item 14), a link to each assessment's detail page.
- **Admin assessment detail** (`app/(admin)/admin/assessments/[id]/page.tsx`): profile / questionnaire answers (stale ones marked) / documents / activity-audit-trail sections. Document view/download goes only through `app/(admin)/admin/documents/[id]/download/route.ts`, which issues a fresh 5-minute signed URL and audits the access (`document_accessed`) — the bucket is never public and no raw storage path ever reaches the browser. Document delete (`domain/documents/service.ts` `deleteDocumentAsAdmin()`) removes the storage object and soft-deletes the DB row, both audited (`document_deleted`), no undo (item 17). Reopen is a Server Action calling `reopenAssessment()`. No legal-findings section exists here — deliberately, per your instruction.
- **Tests**: 97 new tests (86 in 9 new test files; 11 added to two existing files, `tests/api-answers.integration.test.ts` and `tests/document-validation.test.ts`), taking the suite from 92 to 189 tests across 17 files. Covers all 11 areas your instruction listed (branching/stale answers, autosave, submission, locked assessment, attorney reopen, answer validation, document list/view authorization, signed-URL authorization, DOCX-vs-arbitrary-ZIP, XLSX-vs-arbitrary-ZIP, cross-assessment admin/client isolation) — see the Phase 2 completion report for the exact file list.
- **Manual verification**: no live Supabase project is reachable in this build environment (unchanged since Phase 1.1 — OPEN_QUESTIONS.md item 4/8). Beyond `tsc`/`eslint`/the full Vitest suite/`next build`, the new client and admin flows were driven end-to-end against a real running `next dev` server using a temporary, fully-reverted in-memory repository swap (no invented Supabase credentials used anywhere) — see OPEN_QUESTIONS.md item 20 for exactly what was and wasn't covered by that pass.
