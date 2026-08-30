-- Legal Mapping MVP — Phase 1 schema (MASTER_BUILD_SPEC.md §5).
--
-- Design notes:
--  * Every table has Row Level Security ENABLED with no permissive policy
--    for `anon` or `authenticated`, except `admin_profiles`/read policies
--    explicitly scoped to the signed-in attorney. The application talks to
--    Postgres in two ways only:
--      1. The public assessment flow uses the service-role key from
--         server-side API routes, ONLY after verifying a hashed assessment
--         token in application code (see lib/security/token.ts and
--         OPEN_QUESTIONS.md #3 for why RLS alone can't do this — the raw
--         token is never stored, so no RLS predicate can compare against
--         it).
--      2. The admin app uses Supabase Auth; RLS policies below grant an
--         authenticated admin (a row in admin_profiles) read/write access
--         as defense-in-depth, in addition to server-side checks.
--  * `secure_token_hash` stores an HMAC-SHA256 digest, never a raw token.
--  * No table stores document content or extracted personal data inline in
--    a way that would leak into ordinary query logs beyond structured
--    columns already designed for that data (extraction_json etc. are
--    expected to hold structured facts, not raw file bytes).

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- Enumerations
-- ---------------------------------------------------------------------

create type assessment_status as enum (
  'DRAFT',
  'ANALYZED',
  'LAWYER_REVIEW',
  'APPROVED',
  'CLIENT_REPORT_RELEASED'
);

create type answer_source as enum ('client', 'attorney', 'derived');

create type document_upload_status as enum ('pending', 'uploaded', 'failed', 'deleted');

create type extraction_status as enum ('pending', 'completed', 'failed');

create type finding_status as enum ('draft', 'confirmed', 'modified', 'dismissed');

create type risk_level as enum ('LOW', 'MEDIUM', 'SIGNIFICANT', 'HIGH', 'CRITICAL');

create type report_type as enum ('internal', 'client');

-- ---------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------

create function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------
-- admin_profiles: one row per attorney/admin Supabase Auth user.
-- Existence of a row (not its content) is what RLS policies below check.
-- ---------------------------------------------------------------------

create table admin_profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  created_at timestamptz not null default now()
);

alter table admin_profiles enable row level security;

create policy "admin can read own profile"
  on admin_profiles for select
  using (auth.uid() = id);

-- ---------------------------------------------------------------------
-- organizations
-- ---------------------------------------------------------------------

create table organizations (
  id uuid primary key default gen_random_uuid(),
  legal_name text not null,
  business_type text,
  industry text,
  branch_count integer,
  current_employee_count integer,
  former_employee_count_12m integer,
  freelancer_count integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger organizations_set_updated_at
  before update on organizations
  for each row execute function set_updated_at();

alter table organizations enable row level security;

create policy "admin full access to organizations"
  on organizations for all
  using (exists (select 1 from admin_profiles where id = auth.uid()))
  with check (exists (select 1 from admin_profiles where id = auth.uid()));

-- ---------------------------------------------------------------------
-- assessments
-- ---------------------------------------------------------------------

create table assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations (id) on delete cascade,
  status assessment_status not null default 'DRAFT',
  assessment_version text not null default 'V1',
  questionnaire_version text not null default 'V1',
  rule_engine_version text not null default 'V1',
  secure_token_hash text not null unique,
  token_expires_at timestamptz not null,
  submitted_at timestamptz,
  approved_at timestamptz,
  approved_by uuid references admin_profiles (id),
  retention_days integer, -- null = no automatic expiry (OPEN_QUESTIONS.md #6)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index assessments_organization_id_idx on assessments (organization_id);
create index assessments_secure_token_hash_idx on assessments (secure_token_hash);

create trigger assessments_set_updated_at
  before update on assessments
  for each row execute function set_updated_at();

alter table assessments enable row level security;

create policy "admin full access to assessments"
  on assessments for all
  using (exists (select 1 from admin_profiles where id = auth.uid()))
  with check (exists (select 1 from admin_profiles where id = auth.uid()));

-- ---------------------------------------------------------------------
-- answers
-- ---------------------------------------------------------------------

create table answers (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments (id) on delete cascade,
  question_id text not null, -- matches questionnaire.csv "ID" (e.g. GEN-01)
  value_json jsonb not null,
  source answer_source not null default 'client',
  answered_at timestamptz not null default now(),
  unique (assessment_id, question_id)
);

create index answers_assessment_id_idx on answers (assessment_id);

alter table answers enable row level security;

create policy "admin full access to answers"
  on answers for all
  using (exists (select 1 from admin_profiles where id = auth.uid()))
  with check (exists (select 1 from admin_profiles where id = auth.uid()));

-- ---------------------------------------------------------------------
-- documents
-- ---------------------------------------------------------------------

create table documents (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments (id) on delete cascade,
  document_type text not null, -- matches document_analysis_matrix.csv "ID" (e.g. DOC-01)
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  sha256 text not null,
  upload_status document_upload_status not null default 'pending',
  uploaded_at timestamptz not null default now(),
  deleted_at timestamptz
);

create index documents_assessment_id_idx on documents (assessment_id);

alter table documents enable row level security;

create policy "admin full access to documents"
  on documents for all
  using (exists (select 1 from admin_profiles where id = auth.uid()))
  with check (exists (select 1 from admin_profiles where id = auth.uid()));

-- ---------------------------------------------------------------------
-- document_extractions
-- ---------------------------------------------------------------------

create table document_extractions (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references documents (id) on delete cascade,
  schema_name text not null,
  schema_version text not null,
  provider text not null,
  model text not null,
  extraction_json jsonb not null default '{}'::jsonb,
  confidence_json jsonb not null default '{}'::jsonb,
  evidence_json jsonb not null default '{}'::jsonb,
  status extraction_status not null default 'pending',
  created_at timestamptz not null default now()
);

create index document_extractions_document_id_idx on document_extractions (document_id);

alter table document_extractions enable row level security;

create policy "admin full access to document_extractions"
  on document_extractions for all
  using (exists (select 1 from admin_profiles where id = auth.uid()))
  with check (exists (select 1 from admin_profiles where id = auth.uid()));

-- ---------------------------------------------------------------------
-- derived_facts
-- ---------------------------------------------------------------------

create table derived_facts (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments (id) on delete cascade,
  fact_key text not null, -- e.g. "contract.overtime.type"
  value_json jsonb not null,
  source_type text not null, -- e.g. "document_extraction" | "answer" | "cross_check"
  source_id uuid,
  confidence smallint check (confidence between 1 and 4),
  created_at timestamptz not null default now()
);

create index derived_facts_assessment_id_idx on derived_facts (assessment_id);

alter table derived_facts enable row level security;

create policy "admin full access to derived_facts"
  on derived_facts for all
  using (exists (select 1 from admin_profiles where id = auth.uid()))
  with check (exists (select 1 from admin_profiles where id = auth.uid()));

-- ---------------------------------------------------------------------
-- rule_evaluations
-- ---------------------------------------------------------------------

create table rule_evaluations (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments (id) on delete cascade,
  rule_id text not null, -- matches rule_catalog.csv "Rule ID" (e.g. R-EMP-001)
  rule_version text not null default 'V1',
  matched boolean not null,
  input_snapshot jsonb not null,
  base_severity smallint not null check (base_severity between 1 and 5),
  scope_points smallint not null default 0,
  duration_points smallint not null default 0,
  systemic_points smallint not null default 0,
  dispute_points smallint not null default 0,
  override_critical boolean not null default false,
  risk_score smallint not null check (risk_score between 0 and 100),
  risk_level risk_level not null,
  confidence smallint check (confidence between 1 and 4),
  created_at timestamptz not null default now()
);

create index rule_evaluations_assessment_id_idx on rule_evaluations (assessment_id);

alter table rule_evaluations enable row level security;

create policy "admin full access to rule_evaluations"
  on rule_evaluations for all
  using (exists (select 1 from admin_profiles where id = auth.uid()))
  with check (exists (select 1 from admin_profiles where id = auth.uid()));

-- ---------------------------------------------------------------------
-- findings
-- ---------------------------------------------------------------------

create table findings (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments (id) on delete cascade,
  rule_evaluation_id uuid references rule_evaluations (id) on delete set null,
  category text not null,
  sub_category text,
  internal_title text not null,
  client_title text,
  draft_internal_text text,
  draft_client_text text,
  recommended_action text,
  risk_score smallint check (risk_score between 0 and 100),
  risk_level risk_level,
  confidence smallint check (confidence between 1 and 4),
  status finding_status not null default 'draft',
  visible_to_client boolean not null default false,
  lawyer_notes text,
  severity_override smallint check (severity_override between 1 and 5),
  override_reason text,
  reviewed_by uuid references admin_profiles (id),
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint override_requires_reason check (
    severity_override is null or override_reason is not null
  )
);

create index findings_assessment_id_idx on findings (assessment_id);

create trigger findings_set_updated_at
  before update on findings
  for each row execute function set_updated_at();

alter table findings enable row level security;

create policy "admin full access to findings"
  on findings for all
  using (exists (select 1 from admin_profiles where id = auth.uid()))
  with check (exists (select 1 from admin_profiles where id = auth.uid()));

-- ---------------------------------------------------------------------
-- reports
-- ---------------------------------------------------------------------

create table reports (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments (id) on delete cascade,
  report_type report_type not null,
  version integer not null default 1,
  storage_path text not null,
  generated_by uuid references admin_profiles (id),
  generated_at timestamptz not null default now()
);

create index reports_assessment_id_idx on reports (assessment_id);

alter table reports enable row level security;

create policy "admin full access to reports"
  on reports for all
  using (exists (select 1 from admin_profiles where id = auth.uid()))
  with check (exists (select 1 from admin_profiles where id = auth.uid()));

-- ---------------------------------------------------------------------
-- audit_events
--
-- Append-only: no update/delete policy is granted to anyone (including
-- admins) through PostgREST; corrections are new events, never edits.
-- Only structured, non-sensitive fields are logged — never document
-- contents or full extracted values (spec §5, §17).
-- ---------------------------------------------------------------------

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null, -- 'admin' | 'client' | 'system'
  actor_id text, -- admin_profiles.id as text, or a token-derived opaque client ref
  assessment_id uuid references assessments (id) on delete set null,
  event_type text not null, -- 'login' | 'link_created' | 'document_accessed' | 'analysis_run' | 'finding_overridden' | 'approval' | 'report_generated' | 'deletion' | ...
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index audit_events_assessment_id_idx on audit_events (assessment_id);
create index audit_events_created_at_idx on audit_events (created_at);

alter table audit_events enable row level security;

create policy "admin can read audit_events"
  on audit_events for select
  using (exists (select 1 from admin_profiles where id = auth.uid()));

create policy "admin can insert audit_events"
  on audit_events for insert
  with check (exists (select 1 from admin_profiles where id = auth.uid()));
