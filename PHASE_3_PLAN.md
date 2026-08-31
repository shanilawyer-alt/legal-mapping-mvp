# Phase 3 Plan — Pilot Readiness

> Scope: reach `PILOT_READY` — one complete, testable, deterministic
> end-to-end assessment flow from client answers/documents through
> findings, exposure, attorney review, and an unreleased report preview.
> Not an open-ended feature expansion. Rule Engine, AI extraction,
> cross-check, findings, review, and report generation — the master
> spec's own Phases 3–6 — are consolidated into this one pilot-readiness
> phase, per your explicit instruction in this session. No Phase-4+
> (post-pilot) enhancement is in scope.

## 0. Pre-implementation source review

Re-read in full before writing any code: `MASTER_BUILD_SPEC.md`,
`rule_catalog.csv` (42 rows), `freelancer_screening_model.csv` (14 rows),
`exposure_factors.csv` (23 rows), `document_analysis_matrix.csv` (8 rows),
`report_structure.csv` (12 rows), `legal_sources.csv` (15 rows), the
current `OPEN_QUESTIONS.md` (20 items) and `IMPLEMENTATION_PLAN.md`.
Inspected the existing schema (`supabase/migrations/20260830000000_init_schema.sql`)
and found that `document_extractions`, `derived_facts`, `rule_evaluations`,
`findings`, and `reports` tables — plus `assessments.approved_at`/
`approved_by` and the `extraction_status`/`finding_status`/`risk_level`/
`report_type` enums — were **already created in Phase 1** and have sat
unused since. Phase 3 builds against this existing schema; no new tables
are needed, only new repository ports/adapters over the existing ones and
one small migration (§2 below).

## 1. Critical finding: `rule_catalog.csv`'s "תנאי לוגי V1" column is not a machine-parseable DSL

Programmatically dumped all 42 conditions and cross-checked them against
the actual `questionnaire.csv` option strings they reference. Example:
`R-TIME-002`'s condition reads `TIME-07 כולל כלולות בשכר או לא משולמות`,
but `TIME-07`'s real options are `"כלולות בשכר החודשי"` and `"לא משולמות
בנפרד"` — the condition text paraphrases/abbreviates the real option
strings rather than quoting them exactly. Several conditions reference
concepts with no corresponding question field at all (`R-PAY-002`: `AI
מזהה סתירה בין מסמך לתלוש/תיאור` — "AI detects a contradiction between
document and payslip/description"; `R-PRIV-002`: a role-based-access
judgment call; `R-DPO-001`'s second clause: "activity characteristics
requiring review exist," with no enumerated criteria anywhere in the
CSVs). This means the questionnaire-branching grammar approach (Phase 1,
a strict `QUESTION_ID op value` parser) **cannot** be reused unmodified
for rule conditions — force-fitting one would mean guessing which
abbreviated phrase maps to which real option, which is exactly the kind
of invented legal logic the instruction forbids.

**Resolution, per spec §11's own wording** ("Build a safe typed condition
evaluator **or translate CSV rules into typed code**"): each of the 42
rules is hand-translated into a typed TypeScript predicate
(`domain/rules/catalog.ts`), using only the fields named in the rule's
own `קלטים` (inputs) column and comparisons stated in its `תנאי לוגי V1`
column, resolved against the *real* `questionnaire.csv` option strings.
This is implementing the CSV's own stated logic, not inventing new logic.
Every rule definition is validated at import/startup against
`rule_catalog.json` (Rule ID exists, base severity matches, critical-
override flag matches, referenced input question IDs exist in
`questionnaire.csv`) — see §4. A rule whose condition cannot be reduced
to a decidable predicate at all is never auto-matched (see §2).

## 2. Critical finding: the CSV's own `אוטומציה` (automation) column is the authoritative scoping signal

Tabulated all 42 rules' automation-level values: **18 `אוטומטי`**
(automatic — pure questionnaire-answer conditions, safe to auto-evaluate
to true/false), **5 `AI+Rule`** + **1 `AI`** (depend on a document-
extraction or cross-check-derived fact), **10 `Rule+Manual`** + **5
`אוטומטי+Manual`** (a deterministic partial check plus a mandatory human
judgment), **3 `Manual`** (`R-LIT-001`, `R-PRIV-002`, `R-INC-001` — the
CSV itself says these require human assessment, not automation).

**Policy adopted, flagged in OPEN_QUESTIONS.md item 21 before
implementation**: the Rule Engine evaluates every rule and always
produces a `rule_evaluations` row (for traceability), but **only sets
`matched = true` automatically for a rule whose condition is fully
decidable from canonical facts** — which in practice is every `אוטומטי`
rule, plus the deterministic half of `AI+Rule`/`Rule+Manual`/`אוטומטי
+Manual` rules where the specific sub-condition needed is itself
decidable (e.g. `R-CAM-002`'s `PRIV-08=כן AND PRIV-11=לא/חלקי` is fully
answer-based despite the rule's overall automation tag including a manual
step elsewhere in its lifecycle). A rule tagged `Manual`, or whose
condition text has no decidable predicate at all (`R-PAY-002`'s bare "AI
detects a contradiction" with no defined comparison, `R-DPO-001`'s
undefined "activity characteristics"), is **never** auto-matched —
its evaluation is recorded with `matched = false` and a
`requiresManualReview = true` flag, surfaced to the attorney with the raw
condition text, never silently resolved either way. This is not a gap
introduced by this implementation; it is the CSV's own stated
methodology, honored rather than overridden.

## 3. Canonical fact model

`domain/facts/types.ts` — a `CanonicalFact` matching the existing
`derived_facts` table shape exactly (`factKey`, `valueJson`, `sourceType`,
`sourceId`, `confidence 1-4 | null`, `createdAt`), using the dot-namespaced
key style spec §5 itself gives as examples (`contract.overtime.type`,
`payslip.global_overtime.amount`, `attendance.actual_overtime_hours`).
Three producers write to this one fact store, each is required to carry
provenance (`sourceType: "answer" | "document_extraction" | "cross_check"`,
`sourceId` pointing at the answer/extraction/cross-check-result row):
- questionnaire answers (via `computeEffectiveAnswers()`, Phase 2 —
  reused, not rebuilt, so branching interacts correctly: a fact derived
  from a stale/inactive answer is never produced);
- document extraction output (§5 below);
- system-derived calculations (e.g. `attendance.actual_overtime_hours`
  computed from a payslip+attendance comparison).

The Rule Engine and cross-check engine read only from this fact layer,
never from raw `document_extractions.extraction_json` or raw answer
values directly — this is the "rule engine operates on normalized facts,
not raw AI prose" requirement.

## 4. Rule Engine

`domain/rules/catalog.ts` (42 hand-translated rule definitions, one const
array), `domain/rules/validateCatalog.ts` (startup check: catalog Rule IDs
= CSV Rule IDs exactly, severities match, critical-override flags match,
every referenced input ID resolves in `questionnaire.csv` or is a known
fact key — run in a test against real data, mirroring the Phase 1
CSV-integrity-test pattern), `domain/rules/evaluate.ts` (pure function:
`(facts, catalog) → RuleEvaluationResult[]`, one entry per rule, every
evaluation carrying its full input snapshot for traceability — "store
which facts triggered each finding, store which rule generated each
finding" is satisfied by `rule_evaluations.input_snapshot` +
`findings.rule_evaluation_id`). No `eval`/`new Function` anywhere.

## 5. Exposure/risk scoring

`domain/rules/scoring.ts`, implementing spec §12 exactly: base severity
(1–5 → 10/20/30/40/50, from `exposure_factors.csv`), scope
(`max(absoluteBucket, percentageBucket)`, both bucket tables from the
CSV), duration and systemic and active-dispute point tables (CSV-sourced),
`riskScore = min(100, base+scope+duration+systemic+dispute)`, risk bands
(LOW/MEDIUM/SIGNIFICANT/HIGH/CRITICAL), `criticalOverride` forcing
CRITICAL regardless of score. Confidence (1–4) computed and stored
separately per spec's explicit "confidence must never increase risk."
Values cross-validated against `exposure_factors.json` at test time, same
pattern as §4.

## 6. Freelancer screening

`domain/rules/freelancerScreening.ts`, spec §13: sums
`freelancer_screening_model.csv`'s directional points (`FR-*` indicators,
±5/±10) into LOW/MEDIUM/SIGNIFICANT/HIGH, always paired with the exact
mandated wording ("The screening score reflects accumulated factual
indicators and does not determine the legal status of the service
provider" — Hebrew, sourced verbatim from spec §13, never altered),
records which indicators contributed for the attorney view. Screening
only runs when triggered (freelancer section answered, per existing
branching), never asserts legal employment status.

## 7. Document extraction layer

`domain/extraction/types.ts` (a `DocumentExtractor` provider interface —
`extract(document, schemaName) → ExtractionResult`, returning structured
fields + per-field evidence + a confidence/uncertainty state, never free
prose), one Zod schema per `document_analysis_matrix.csv` row's "what the
AI extracts" column, for all 8 document types, with the 5 spec-§21-named
schemas (agreement/DOC-01, payslip/DOC-03, attendance/DOC-04, freelancer
agreement/DOC-06, privacy notice/DOC-07) given full field coverage per
spec §8; the other 3 (DOC-02 notice, DOC-05 bonus plan, DOC-08 harassment
policy) get a schema too but lighter cross-check usage, since nothing in
§21's acceptance criteria names them.

**No live AI provider credentials exist in this environment** (unchanged
since Phase 1 — OPEN_QUESTIONS.md items 4/8). Per your explicit
instruction C, this phase implements the provider interface plus a
**deterministic synthetic/mock extraction implementation**
(`domain/extraction/syntheticProvider.ts`) that maps a document's SHA-256
(or an explicit fixture tag on upload) to one of a small set of canned,
versioned fixture extractions matching spec §22's synthetic test fixtures
(A–D). This is not a claim of real-provider verification — it exists
solely so the full pipeline is testable end-to-end without fabricating
production verification, exactly as instructed. An extraction with no
matching fixture returns an explicit `uncertain`/`failed` status rather
than guessing.

## 8. Cross-check engine

`domain/crosscheck/`, implementing exactly spec §10's four named
comparisons (also §21's four minimum demonstrations): (1) employee-notice
coverage (no automatic violation when `EMP-02=no` and an agreement
exists — derives a "requires contract-coverage check" fact instead), (2)
global-overtime agreement/payslip/attendance mismatch, (3) privacy
contradiction (client says no monitoring, a document shows GPS/location —
a neutral contradiction fact, never an accusation), (4) freelancer
indicator aggregation (factual only, no status determination). Results
are `derived_facts` rows (`sourceType: "cross_check"`) — kept separate
from findings until the deterministic rules in §4 evaluate them, per your
explicit instruction D.

## 9. Findings

`domain/findings/generate.ts`: one `findings` row per matched (or
requires-manual-review) rule evaluation, populated only with the fields
spec §5/§15 actually define (Rule ID via `rule_evaluation_id`, category,
internal/client title and text, recommended action, risk score/level,
confidence, factual basis via `input_snapshot`, legal source URL from
`rule_catalog.csv`'s own column, status defaulting to `draft`,
`visible_to_client` defaulting to `false`) — no invented fields. All
Hebrew wording (finding titles, recommendations) is copied verbatim from
`rule_catalog.csv`'s own columns (`ממצא/נושא`, `המלצה ראשונית`), never
generated/rephrased.

## 10. Attorney review workspace (admin UI)

Extends `app/(admin)/admin/assessments/[id]/page.tsx` with new sections:
extracted facts (with provenance), cross-check results, findings (each
showing Rule ID, severity, risk score/level, confidence, evidence,
recommendation), and a "Run Analysis" action (`SUBMITTED → ANALYZED →
LAWYER_REVIEW`, one atomic step — see OPEN_QUESTIONS.md item 22 for why).
Finding actions exactly per spec §15: confirm / modify / dismiss /
override severity (reason mandatory — already enforced by the existing
`override_requires_reason` DB constraint) / add note / visible-to-client
toggle. "Approve" (`LAWYER_REVIEW → APPROVED`) is blocked while any
`draft`-status CRITICAL finding remains, per spec §15's explicit rule.
**No reopen action is added** — OPEN_QUESTIONS.md item 16 remains
unresolved and out of scope for this phase, exactly as instructed.

## 11. Report generation

`domain/reports/`: assembles a report's content from `report_structure.csv`'s
own field layer (Executive/Finding/Commercial/Privacy/Freelancer ×
client/professional output), strictly separating client-safe wording
(no Rule IDs, no score formula, no internal notes — per spec §16) from
the internal version (full traceability). **Format scoping decision,
flagged in OPEN_QUESTIONS.md item 23**: the pilot's report "preview" is
rendered as structured HTML stored in the private document bucket (via
the existing `DocumentStore` — reusing infrastructure rather than adding
a new one) and viewed in the admin UI via a signed URL, not a binary PDF —
binary PDF generation is master-spec Phase 6, a distinct, avoidable scope
addition for a pilot proof. A `reports` row is only ever created by an
explicit attorney action; release (`APPROVED → CLIENT_REPORT_RELEASED`)
is a second, separate, explicit, audited action — never automatic.

## 12. Audit trail

New event types recorded via the existing `AuditRepository`, no new
audit infrastructure needed: `document_extracted`, `fact_created`,
`rule_evaluation_run`, `finding_created`, `finding_reviewed`
(confirm/modify/dismiss/override, metadata carries which), `analysis_run`,
`report_generated`, `report_released`. Never logs document content or
extracted personal-data values — only structured, non-sensitive metadata
(rule ID, finding ID, counts), matching the existing pattern from Phase 1/2.

## 13. New repository ports

`DocumentExtractionRepository`, `DerivedFactRepository`,
`RuleEvaluationRepository`, `FindingRepository`, `ReportRepository` —
added to `lib/db/repositories.ts`, implemented in both
`lib/db/inMemory.ts` and `lib/db/supabase/repositories.ts`, exactly
mirroring the existing port/adapter pattern from Phase 1/2. One small
migration adds nothing structurally new (all 5 tables already exist) but
is needed only if a genuine gap is found while wiring the adapters (none
currently anticipated — see §0).

## 14. `PILOT_READY` acceptance test

A single end-to-end integration test drives all 15 steps from the
instruction against the in-memory repository set (the same
no-live-Supabase constraint as every prior phase — OPEN_QUESTIONS.md
items 4/8 still apply, disclosed the same way, not silently worked
around): create → client token access → questionnaire completion →
synthetic document upload → submit → run analysis (extraction → facts →
cross-check → rules → findings/exposure) → attorney review of every
input/output → report preview generated → still unreleased pending
approval → audit trail shows the lifecycle → cross-assessment isolation
holds throughout. This test is the actual gate for declaring
`PILOT_READY`, not the mere existence of the individual components.

## 15. Explicitly out of scope for this phase

Reopen wiring (item 16, unresolved), binary PDF rendering (§11), a
client-facing report *viewing* page (nothing in the 15-step acceptance
list requires the client to see the report — the pilot only requires it
generated and gated), re-running analysis on an already-`ANALYZED`
assessment (new item, flagged in OPEN_QUESTIONS — single-run only for
this phase), `admin_profiles`-scoped authorization (item 15, pre-existing,
unresolved), real AI provider integration (no credentials — §7), and any
document category not in `document_analysis_matrix.csv`'s 8 rows.
