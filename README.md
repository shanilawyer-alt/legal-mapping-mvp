# Legal Mapping MVP

Attorney-supervised legal-risk mapping for businesses (Israeli employment law,
workplace privacy, and freelancer/independent-contractor classification
risk). Hebrew-first, RTL. See `MASTER_BUILD_SPEC.md` for the full product
specification and `IMPLEMENTATION_PLAN.md` for what Phase 1 builds and why.

**Non-negotiable product constraint**: AI extracts facts. Deterministic
attorney-defined rules determine findings. No client report is released
without attorney review.

## Status

Phase 1 only (see `FIRST_PROMPT_FOR_CLAUDE_CODE.md` and
`IMPLEMENTATION_PLAN.md`): app scaffold, database schema, admin auth,
token-based assessment access, CSV import/validation, the Hebrew RTL
questionnaire shell with deterministic branching, and a private
document-storage abstraction. No AI extraction, Rule Engine evaluation, or
report generation yet — see `IMPLEMENTATION_PLAN.md` §10 for the exact
boundary, and `OPEN_QUESTIONS.md` for decisions that need attorney sign-off.

## Source data

`data/` holds the seven authoritative CSVs (`questionnaire.csv`,
`rule_catalog.csv`, `freelancer_screening_model.csv`,
`exposure_factors.csv`, `document_analysis_matrix.csv`,
`report_structure.csv`, `legal_sources.csv`) plus the reference workbook
they were originally exported from (`data/reference/`). **Read
`OPEN_QUESTIONS.md` #1** before editing `questionnaire.csv` or
`rule_catalog.csv` — the versions in this repo were reconstructed from the
reference workbook after being committed empty, and that reconstruction
needs attorney confirmation.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in a real Supabase project's values
npm run dev
```

`npm run dev` and `npm run build` both regenerate `data/generated/*.json`
from the CSVs first (`npm run import:csv`), validating schema and
cross-file referential integrity — the build fails loudly on any CSV
problem rather than shipping a broken questionnaire.

Database migrations live in `supabase/migrations/`. Apply them to a real
(synthetic-data-only in development) Supabase project with the Supabase
CLI: `supabase link` then `supabase db push`. There is no live Supabase
project connected in this development environment — see
`OPEN_QUESTIONS.md` #4.

At least one attorney/admin account needs a corresponding row in
`admin_profiles` (see `supabase/migrations/20260830000000_init_schema.sql`)
after creating the Supabase Auth user, or admin routes will authenticate
but find no authorized profile.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Start the dev server (imports/validates CSVs first) |
| `npm run build` | Production build (imports/validates CSVs first) |
| `npm run import:csv` | Validate the 7 CSVs and regenerate `data/generated/*.json` |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Run the unit test suite (Vitest) |
| `npm run lint` | ESLint |

## Testing

`npm test` covers:
- **CSV validation** (`tests/csv-validation.test.ts`): every real CSV
  parses against its schema with zero errors, IDs are unique, and
  cross-file references (rule inputs → question/document IDs, freelancer
  model → question IDs) all resolve.
- **Branching** (`tests/branching.test.ts`): the trigger-condition parser
  and evaluator, plus a regression check that all 103 real questionnaire
  triggers parse and evaluate without throwing.
- **Token isolation** (`tests/token-isolation.test.ts`): a client holding
  one assessment's token can never read or write another assessment's
  answers — the core security property behind the public questionnaire
  link. Uses an in-memory repository implementation
  (`lib/db/inMemory.ts`) since no live Supabase project is reachable from
  this build environment.

## Security assumptions

See `IMPLEMENTATION_PLAN.md` §8 and `OPEN_QUESTIONS.md` for the full
reasoning. In short: raw assessment tokens are never persisted (only an
HMAC-SHA256 digest); the public questionnaire flow never talks to Postgres
with the anon key, only through server-only code after token verification;
RLS is enabled on every table as defense-in-depth; documents live in a
private Supabase Storage bucket behind short-lived signed URLs; secrets are
read only from environment variables server-side (`lib/security/env.ts`
fails fast on boot if any are missing); all fixtures and test data are
synthetic.
