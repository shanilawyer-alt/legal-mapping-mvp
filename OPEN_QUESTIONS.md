# Open Questions / Proposed Changes

> **Revision note (Phase 1.1)**: items 1, 2, 3, 5, and 6 below were reviewed
> and explicitly decided; each now records the decision rather than posing
> an open question. Item 4's claim of a `--write-db` mode was found to be
> false (no such flag was ever built) and has been corrected. New items 7–10
> were added during Phase 1.1 hardening.
>
> **Revision note (Phase 2)**: item 9's 24-hour session lifetime is now
> **APPROVED**. Item 7's DOCX/XLSX depth limitation and item 10's missing
> document viewer are now **RESOLVED** — see their updated text. New items
> 11–18 were added during Phase 2, including the one schema change Phase 2
> required (item 11), documented here before it was implemented, per your
> instruction.

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

## 7. Server-side file-signature verification depth — **RESOLVED (Phase 2)**

Phase 1.1 added `lib/security/fileSignature.ts`, sniffing actual file content rather than trusting the browser-supplied MIME type, but only confirmed DOCX/XLSX were "a genuine ZIP," not which kind.

**Phase 2 resolution**: `lib/security/zipEntries.ts` (new) parses the ZIP central directory (no external dependency, no `eval`, no decompression of any entry's content) to list entry names. `lib/storage/validation.ts` now additionally requires `word/document.xml` among a declared-DOCX upload's entries and `xl/workbook.xml` among a declared-XLSX upload's — an arbitrary ZIP renamed to either extension, or one whose central directory doesn't even parse, is rejected with its own `ooxml_mismatch` code (kept distinct from `type_mismatch`, which is the outer-signature check that already existed). **Remaining limit**: this checks for the presence of the one entry each format cannot function without; it does not validate the full OOXML schema, `[Content_Types].xml` correctness, or that the document is well-formed/uncorrupted beyond that. A deliberately crafted ZIP containing a spuriously-named `word/document.xml`/`xl/workbook.xml` alongside otherwise arbitrary content would still pass — closing that would require actually parsing the XML content, not just checking for the entry's existence. Flag if this remaining gap needs closing before real client documents are handled.

## 8. Real Supabase verification — exact status and next steps

**What this sandbox can and can't do**: the Docker daemon needed for `supabase start` (a full local Supabase stack: Postgres + GoTrue + PostgREST + Storage + Realtime) is installed but not running here (`docker ps` fails — no socket), and there is no network egress to supabase.com or any external Supabase project (outbound requests are blocked by the environment's proxy). Plain PostgreSQL 16 **is** installed and was used for a best-effort, clearly-partial check (see below) — no credentials for any real external Supabase project were invented or guessed, per your explicit instruction.

**What was actually verified this way**: all 4 migration files (the 4th, `20260830000003_assessment_status_submitted.sql`, added in Phase 2) apply cleanly, in order, to a real PostgreSQL 16 database, against a minimal hand-written local stand-in for Supabase's `auth.users` table, `auth.uid()` function, and `storage.buckets` table (needed only because the migrations reference them; this stand-in was never committed to the repo — it existed only in a throwaway local database, created and dropped in this session, both in Phase 1.1 and again in Phase 2 to cover the new migration). After applying all 4, `pg_enum` confirms `SUBMITTED` sits between `DRAFT` and `ANALYZED` as intended. This confirms:
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

## 9. Session lifetime (24 hours) — **APPROVED (Phase 2)**

Phase 1.1's session token is capped at 24 hours (and can never outlive its parent assessment token). **Decision**: approved for the MVP. Unchanged in Phase 2.

## 10. Admin document viewer — **RESOLVED (Phase 2)**

`DocumentStore.getSignedDownloadUrl()` existed since Phase 1 but nothing called it. Phase 2 wires it into the admin assessment detail page (a server action issues a short-lived signed URL on demand; the bucket itself is never made public, and no raw storage path is ever sent to the browser). See item 6 of the Phase 2 report.

## 11. `assessment_status` needs a `SUBMITTED` value — PROPOSED, then **IMPLEMENTED**

**The gap**: the enum as it stood (`DRAFT`, `ANALYZED`, `LAWYER_REVIEW`, `APPROVED`, `CLIENT_REPORT_RELEASED`) has no state meaning "the client has finished and submitted, but the Rule Engine has not run yet." `ANALYZED` specifically implies the Phase 3 Rule Engine has already produced results — using it for "just submitted" would misrepresent that analysis happened when it hasn't. Phase 2's submission-lifecycle requirement (lock answers after submit, let an attorney reopen) has nothing correct to transition `assessments.status` to without this.

**Why this is clearly necessary, not just convenient**: without a distinct `SUBMITTED` state, either (a) submission would have to skip changing `status` at all — but then "locked from ordinary editing" has no clean signal to key off, and the admin dashboard's "completion/submission state" column (explicitly requested) has nothing truthful to show — or (b) submission would have to jump straight to `ANALYZED`, which is false (no analysis has occurred) and would misrepresent assessment state to a future attorney-review UI that trusts this enum.

**What was done**: a new migration, `supabase/migrations/20260830000003_assessment_status_submitted.sql`, runs `ALTER TYPE assessment_status ADD VALUE 'SUBMITTED' BEFORE 'ANALYZED'`. This is additive (existing enum values, their order relative to each other, and every existing row's status are unaffected) and keeps the original migration files untouched rather than editing already-written history. The workflow is now `DRAFT → SUBMITTED → ANALYZED → LAWYER_REVIEW → APPROVED → CLIENT_REPORT_RELEASED`. `assessments.submitted_at` already existed as a column (unused until Phase 2) and needed no schema change.

Documented here before implementation, per your instruction; proceeded to implement since the gap above is clearly blocking and there was no way to build the requested submission lifecycle correctly without it.

## 12. Required vs. optional questions — not a column in `questionnaire.csv`, so this is a stated policy, not sourced data

`questionnaire.csv` has no `required`/`mandatory` column. The only relevant existing axis is `ליבה/מותנה` ("core"/"conditional"), which governs default visibility, not whether an answer is mandatory to submit.

**Policy adopted for Phase 2** (client-facing UI and server-side submission validation both implement this — see the Phase 2 report §9 and §1): a **core** ("ליבה") question, once visible, must be answered before submission is allowed; a **conditional** ("מותנה") question, even when visible, remains optional; a document-upload request is always optional (spec §6 already says uploads can be skipped). This is a UX/validation policy decision, not a transcription of source data — flag if a different required/optional split is intended (e.g. per-question, which would need a real source column added to `questionnaire.csv` first).

## 13. "Last activity" (admin dashboard column) is computed, not a stored field

No single column captures "last activity" on an assessment. The admin dashboard computes it per assessment as `max(assessment.updatedAt, latest answer.answeredAt, latest document.uploadedAt)` at read time — not stored, not cached. Flag if a materialized/indexed version is needed once assessment volume makes the per-row computation costly (not a concern at pilot scale).

## 14. Employee/freelancer counts on the dashboard come from questionnaire answers, not the `organizations` table

`organizations.current_employee_count`/`.freelancer_count` columns exist in the schema but are never populated — the admin "create assessment" flow only collects a legal name. The dashboard instead reads the client's own answers to `GEN-04` (current employee count) and `GEN-06` (freelancer count) for each assessment, when present. If neither has been answered yet (assessment still in progress), the dashboard shows that plainly rather than a fabricated 0.

## 15. Admin authorization remains "any authenticated Supabase user," not "a user with an `admin_profiles` row" — a pre-existing Phase 1 characteristic, not new to Phase 2

Every admin-only action added in Phase 2 (dashboard, assessment detail, reopen, signed-URL issuance, document delete) is gated the same way Phase 1's `create-assessment-action.ts` already was: `proxy.ts` requires a valid Supabase Auth session, and each server action checks only that a `user` exists — none of them additionally check for a matching `admin_profiles` row. The RLS policies (`exists (select 1 from admin_profiles where id = auth.uid())`) are stricter, but the app never reaches them for these actions — they all use the service-role client, which bypasses RLS by design. This means, as things stand, **any** person who can sign in with a valid Supabase Auth credential for this project — not specifically someone provisioned as an attorney — can use every admin feature. This was true before Phase 2 and is unchanged by it; flagging it here because Phase 2 meaningfully expands what that access can now do (view/download client documents, reopen submitted assessments). Worth deciding whether admin actions should additionally require an `admin_profiles` row before real client data is handled.

## 16. Attorney reopen — **NOT WIRED INTO ANY APPLICATION FLOW; POLICY UNRESOLVED**

**Status change from the earlier version of this item**: reopen was previously described here as a settled decision ("scoped to `SUBMITTED → DRAFT` only") and was wired into the admin detail page as a clickable action. Per your explicit instruction, reopen is being treated as a policy-sensitive operation, not merely a repository method, and the source specifications (MASTER_BUILD_SPEC.md, FIRST_PROMPT_FOR_CLAUDE_CODE.md, and your Phase 2 instruction itself, which said only "attorney may explicitly reopen; reopening must be audited") do **not** explicitly settle the following:

1. **Who may reopen a submitted assessment** — "attorney" is stated, but nothing defines whether that means any authenticated admin user (the only notion of "admin" this codebase currently has — see item 15) or specifically the attorney of record for that assessment, and nothing requires a reason/justification to be recorded beyond the bare fact that a reopen happened.
2. **Whether client answers may be edited after a reopen** — the current `reopenAssessment()` implementation sets `status` back to `DRAFT`, which (via `EDITABLE_ASSESSMENT_STATUSES`) would unconditionally re-enable every existing client-write endpoint. Nothing in the source spec confirms unrestricted re-editing is the intended behavior, as opposed to e.g. a narrower "attorney adds a note and re-submits on the client's behalf" flow, or requiring the client to re-confirm before edits are accepted again.
3. **Whether the original submitted state must be preserved** — the current implementation clears `submitted_at` to `null` on reopen. The original submission's answers, documents, and audit trail remain in the database (nothing is deleted), but there is no separate "submission history" record — a second submission would overwrite the first `submitted_at` value with no built-in way to show "this was submitted once already, then reopened, then submitted again," beyond reading the raw audit log.
4. **What audit event must be recorded** — your instruction says reopening "must be audited," which the current implementation does (`assessment_reopened`, actor = admin user id). This part is not in dispute; it's listed here only because it's one of the five, and to note that no additional metadata (a reopen reason/justification field) is currently captured, since nothing requires one.
5. **What happens to any existing findings/report after reopening** — not applicable to anything actually built through Phase 2 (no findings or report exist yet; the current implementation only ever accepts a `SUBMITTED → DRAFT` transition, so `ANALYZED`/`LAWYER_REVIEW`/`APPROVED`/`CLIENT_REPORT_RELEASED` are unreachable by it). This becomes a real, unresolved question the moment Phase 3 makes any of those states reachable — reopening an assessment that already has Rule Engine output or an attorney-approved report raises exactly the "must a report be treated as stale/void" question the source spec never addresses. Flag before extending reopen's scope to any post-`SUBMITTED` state.

**What exists at the architecture level, per your instruction to keep it**: `domain/assessment/submission.ts` `reopenAssessment()` and the `AssessmentRepository.reopen()` port (implemented in both the in-memory and Supabase adapters) still exist and are still unit-tested (`tests/submission-lifecycle.test.ts`) — those tests describe what the method currently does if called directly, not an approved policy. **What was removed**: the admin detail page's "פתיחה מחדש לעריכה" (reopen) button and its backing Server Action (`app/(admin)/admin/assessments/[id]/actions.ts` previously exported `reopenAssessmentAction`; it has been deleted). There is currently no way for an admin, or anyone else, to trigger a reopen through the running application. Re-wire only after the five questions above are explicitly answered.

## 17. Document delete is a soft-delete plus an actual storage removal, both audited

The admin document-delete action calls the real `DocumentStore.delete()` (removes the object from Supabase Storage) and marks the `documents` row `upload_status = 'deleted'` with `deleted_at` set (the row itself is kept, not hard-deleted, consistent with the existing `markDeleted` repository method from Phase 1). An audit event (`document_deleted`, actor = the admin's user id) is recorded. There is no undo.

## 18. Stale branching answers — deterministic policy, documented before implementation

**The problem**: a client can answer a question, then change an earlier answer that was on the branching path to it. Example: `GEN-04` (employee count) drives whether an `EMP-*` sub-section is shown at all; a client could answer several `EMP-*` questions, then go back and change `GEN-04` to a value that hides that sub-section. The `EMP-*` answers are still sitting in the `answers` table (writes are append/upsert, nothing is deleted on a branching change — data must be preserved for audit/history per your instruction), but they no longer reflect a question the client currently sees or endorses. Handing the raw, unfiltered answer set to any later stage (submission validation, and eventually the Phase 3 Rule Engine) would silently use those stale values as if they were current, which your instruction explicitly forbids.

**Policy adopted**: a new pure function, `computeEffectiveAnswers()` in `domain/questionnaire/effective.ts`, takes the full questionnaire item list and the raw answer map and produces:
- `effectiveAnswers` — only answers belonging to a question that is currently visible (its `triggerCondition` evaluates true) under the current answer set. This is the only answer map ever passed to submission validation (item 33/34) or that a future Rule Engine should read.
- `statuses` — a per-question record (`active`, `hasAnswer`, `stale`) covering every questionnaire item, including ones never answered.
- `staleQuestionIds` — the question IDs excluded from `effectiveAnswers` because their question is no longer active but still has a stored answer. Nothing is deleted; these rows remain in `answers` and remain visible in the admin answers tab (marked as stale, per item 5's audit-trail intent), preserving them for history exactly as instructed.

**Why a single forward pass over `questionnaire.csv` order is deterministic and correct, not a shortcut**: verified programmatically against the generated `data/generated/questionnaire.json` (103 items) that every `triggerCondition` references only question IDs that appear *earlier* in the CSV — zero forward or self references across all 103 rows. That means visibility can be computed in one left-to-right pass, building up the "effective" answer map as you go (a question's trigger is evaluated only against the effective answers of questions already processed, not the raw/unfiltered set), with no fixpoint iteration or cycle handling needed. This mirrors exactly how the client questionnaire UI itself renders sections in order, so "what the client currently sees" and "what analysis will use" are provably the same computation.

**What counts as "the effective submitted assessment"** (per your instruction 3): at submission time, `effectiveAnswers` is what is validated (item 33) and what a future analysis stage reads — never the raw table. The raw table is retained in full for audit; the admin detail view (item 38) marks stale answers explicitly rather than hiding them, so an attorney can still see the client's full answer history.

## 19. Answer-value validation — server-side, sourced from `questionnaire.csv`'s `answerType`/`options`; one normalization policy call

`domain/questionnaire/validate.ts` validates every write to `POST /api/assessments/answers` against the question's actual configured type and (for `single_choice`/`multi_choice`) its actual configured option list, all taken from the same generated `questionnaire.csv` snapshot the client UI renders from — not a separately maintained list. `yes_no`/`yes_no_unknown` use fixed option sets (`domain/questionnaire/types.ts`) since that CSV column is empty for those rows; the same constants are now imported by the client field component, replacing what were previously two independent hardcoded copies. A `questionId` that doesn't exist in the questionnaire at all is rejected (`unknown_question`) rather than silently stored. `null`/`undefined` is always accepted regardless of type — clearing an answer is a legitimate state; whether a question is *required* is decided at submission time (item 34), not on every autosave write.

**One policy call, not sourced from the CSV**: a blank/whitespace-only `short_text` value and an empty `multi_choice` selection are normalized to `null` before validation/storage (`normalizeAnswerValue`), rather than stored as `""`/`[]`. This keeps "has this question been answered" a single, unambiguous check (`!= null`) everywhere it's asked — the effective-answers computation (item 18) and the submission required-question check (item 34) both rely on that. Flag if a distinction between "explicitly cleared" and "never touched" is ever needed; nothing currently observes that difference.

## 20. Client questionnaire UI — review screen, submit, lock, confirmation (item 1/2/8) — and how it was manually verified

The client flow (`app/(public)/assessment/assessment-shell.tsx`) now has three phases: `form` (section-by-section, unchanged from Phase 1 except for required/optional labels driven by `isCore`), `review` (a read-only summary of every currently-active question's answer, grouped by section, each with an "עריכה" link back to it; blocked from submitting while any active core question is unanswered, with that list shown inline), and `confirmation` (renders `components/assessment/submitted-view.tsx`). A fresh page load of a non-DRAFT assessment renders the same `SubmittedView` server-side (`app/(public)/assessment/page.tsx`), so reloading after submission — or an admin reopen — never shows a stale editable form. A `423`/`410` response from any write (autosave or submit) switches the shell to a dedicated locked/expired notice rather than a generic error, per item 8's requirement that an expired session's message make clear saved answers are not lost.

**How this was verified, given no live Supabase project is reachable in this environment** (the same constraint documented in items 4/8 since Phase 1.1): `next build` was run to confirm the production bundle compiles with the new routes/components. Beyond that, rather than only relying on `tsc`/`eslint`, a temporary, fully-reverted local smoke test drove the actual running `next dev` server end-to-end — token exchange → DRAFT form render → posting all 54 currently-required core answers through the real `POST /api/assessments/answers` route → a premature `POST /api/assessments/submit` correctly returning `422 missing_required` with the exact missing question IDs → a complete submit returning `SUBMITTED` → a second submit and a further answer write both correctly returning `423 locked` → a fresh page load after submission correctly server-rendering `SubmittedView` with a formatted Hebrew date → an unknown token and a cookie-less request both correctly rendering the `not_found` `AccessError`. This required temporarily swapping `lib/db/index.ts`'s Supabase-backed `getRepositories()` for the existing in-memory adapter and adding a throwaway seed route, both fully reverted afterward (`git checkout -- lib/db/index.ts`; the seed route deleted) — no trace of this remains in the codebase, and no real or invented Supabase credentials were used at any point. **Not covered by this**: the review screen's and phase transitions' actual in-browser JavaScript behavior (button clicks, edit-link navigation) — that was verified by code reading and TypeScript's checking of the state machine, not by driving a real browser's DOM. A full browser-based (e.g. Playwright) pass, and verification against a real Supabase project, remain open per item 8's original scope.

## 21. Rule automation-level policy — a rule is only ever auto-matched when its condition is fully decidable; `Manual`-tagged and undecidable rules are never resolved automatically

**The problem**: `rule_catalog.csv`'s "תנאי לוגי V1" (logical condition) column is not a strict, literally re-parseable DSL the way `questionnaire.csv`'s trigger column is (verified programmatically — see `PHASE_3_PLAN.md` §1 for the exact evidence, e.g. `R-TIME-002`'s condition text abbreviates `TIME-07`'s real option strings rather than quoting them, and `R-PAY-002`'s condition is the bare, undefined phrase "AI detects a contradiction between document and payslip/description"). Forcing every condition into a mechanically-parsed boolean expression would require guessing at correspondences the CSV itself doesn't state precisely — exactly the kind of invented legal logic your instruction forbids.

**Resolution**: each rule is hand-translated into a typed TypeScript predicate (`domain/rules/catalog.ts`) implementing only what its own `קלטים`/`תנאי לוגי V1` columns state, resolved against the real `questionnaire.csv` option strings — not a runtime parser of the prose. Separately, the CSV's own `אוטומציה` (automation) column — `אוטומטי` (18 rules) / `AI+Rule` (5) / `Rule+Manual` (10) / `אוטומטי+Manual` (5) / `AI` (1) / `Manual` (3) — is used as the authoritative signal for which rules the engine may set `matched = true` on automatically: every rule is evaluated and always produces a `rule_evaluations` row for traceability, but a rule tagged `Manual`, or whose condition has no decidable predicate at all (`R-PAY-002`, `R-DPO-001`'s second clause "activity characteristics requiring review exist" — no criteria defined anywhere), is recorded with `matched = false` and `requiresManualReview = true`, never resolved either way by the engine, always surfaced to the attorney with its raw condition text. This does not weaken the deterministic-rules requirement — it is the CSV's own stated methodology (a `Manual` tag is the source data's own instruction), not a limitation introduced here. Flag if a different automation-level mapping was intended.

## 22. `ANALYZED → LAWYER_REVIEW` transition — combined into one atomic "Run Analysis" action

The spec states the workflow sequence (`DRAFT → SUBMITTED → ANALYZED → LAWYER_REVIEW → APPROVED → CLIENT_REPORT_RELEASED`, §1.3) but does not say what event causes `ANALYZED → LAWYER_REVIEW` specifically, versus `ANALYZED` being a distinct, separately-triggered state. Since `LAWYER_REVIEW` denotes "sitting in the attorney's queue with findings in `draft` status awaiting confirm/modify/dismiss/approve" and nothing else changes between the two states, this phase implements "Run Analysis" (attorney-triggered, per spec §2's "run/re-run analysis") as one atomic step: extraction → facts → cross-check → rules → findings, then `SUBMITTED → ANALYZED → LAWYER_REVIEW` together. This does not skip or weaken the mandatory review gate — findings still start `draft` and still require explicit per-finding attorney action before `APPROVED` is reachable (spec §15). Flag if `ANALYZED` needs to be a separately visible, separately-triggered state instead (e.g. so an attorney can review raw extraction/cross-check output before rules run).

## 23. Report preview format — structured HTML in private storage, not a binary PDF

Spec §3 lists "PDF report generation" among the preferred stack, but the master spec's own build sequence (§23) places PDF reports in **Phase 6**, after cross-checks (Phase 5) and lawyer review (Phase 6) — both later than the "deterministic Rule Engine" it names as Phase 3. Your current instruction asks for a "report preview" for pilot-readiness without specifying a binary format. Adding a PDF-rendering dependency and layout engine is a distinct scope addition not required to prove the deterministic pipeline end-to-end. **Decision for this phase**: the report preview is rendered as structured HTML, stored via the existing private `DocumentStore` (reusing Phase 1/2 infrastructure — short-lived signed URLs, no public path, same as the document viewer), and viewed inline in the admin UI. Binary PDF rendering is deferred as a distinct post-pilot enhancement. Flag if PILOT_READY specifically requires a downloadable PDF rather than an in-app preview.

## 24. Re-running analysis on an already-`ANALYZED` assessment — out of scope for this phase, single run only

Spec §2 lists "run/re-run analysis" as an attorney capability, but nothing defines what should happen to existing `rule_evaluations`/`findings`/attorney review state (confirmed/modified/dismissed findings, notes, severity overrides) on a second run — overwrite, version, or merge are all plausible and materially different in effect, and none is stated. The `PILOT_READY` 15-step acceptance list (your instruction) only requires the pipeline to run **once** per synthetic assessment. **Decision for this phase**: "Run Analysis" is only offered from `SUBMITTED`; there is no re-run path from `ANALYZED`/`LAWYER_REVIEW` in this phase. Re-analysis semantics are explicitly deferred — flag before building a re-run action.

## 25. Synthetic document-extraction fixtures — matching mechanism, and what "verified" does and doesn't mean here

No live AI provider credentials exist in this environment (unchanged since Phase 1 — items 4/8), so per your explicit instruction C this phase implements a `DocumentExtractor` provider interface plus one deterministic, synthetic/mock implementation (`domain/extraction/syntheticProvider.ts`) — never a real model call. A real uploaded document is matched to one of a small, versioned set of canned fixture extractions (covering spec §22's fixtures A–D) by an explicit fixture tag supplied at upload time in the pilot/test flow, not by attempting to actually read the file's content (this implementation does not parse PDFs/DOCX content at all — that is real extraction work, out of scope without a real provider). An unmatched document produces an explicit `uncertain` extraction status, never a guessed result. This is disclosed here so it is never mistaken for real-provider verification in any later report — it proves the pipeline's plumbing (extraction → facts → cross-check → rules → findings) is wired correctly and deterministically, not that real documents can be read.

## 26. Phase 3 attorney-only actions use the same authorization characteristic as item 15

Run Analysis, every per-finding review action, Approve, and Release all reuse the existing admin-gating pattern (`proxy.ts` + a per-action `getAdminUserId()` check) — i.e. "any authenticated Supabase user," not specifically an `admin_profiles`-scoped attorney identity. This is not a new gap; it is item 15's existing, still-unresolved characteristic, now extended to materially more consequential actions (approving and releasing a report). Revisit item 15's resolution before real client data reaches this phase's workflow.
