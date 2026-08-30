# FIRST PROMPT FOR CLAUDE CODE

Build the MVP described in `MASTER_BUILD_SPEC.md`.

Before coding:
1. Read `MASTER_BUILD_SPEC.md` completely.
2. Read every CSV source file:
   - questionnaire.csv
   - rule_catalog.csv
   - freelancer_screening_model.csv
   - exposure_factors.csv
   - document_analysis_matrix.csv
   - report_structure.csv
   - legal_sources.csv
3. Create `IMPLEMENTATION_PLAN.md` summarizing the architecture and the Phase 1 plan.
4. Create `OPEN_QUESTIONS.md` only for genuine implementation ambiguities. Do not ask for information already contained in the files.
5. Do not alter legal Rule IDs, severity values, questionnaire IDs or Hebrew client wording without explicitly documenting a proposed change.

Implement **Phase 1 only**:
- scaffold the production-oriented TypeScript web app;
- PostgreSQL/Supabase schema and migrations;
- admin authentication;
- secure token-based assessment access;
- CSV import/validation scripts;
- Hebrew RTL questionnaire shell;
- deterministic branching framework;
- private document-storage abstraction, but do not transmit documents to an AI model yet;
- baseline security configuration;
- unit tests for CSV validation and assessment-token isolation.

Use synthetic data only.

At completion:
- run tests and typecheck;
- summarize files changed;
- list security assumptions and open questions;
- stop before Phase 2 unless explicitly instructed.

Non-negotiable product constraint:
AI extracts facts. Deterministic attorney-defined rules determine findings. No client report is released without attorney review.
