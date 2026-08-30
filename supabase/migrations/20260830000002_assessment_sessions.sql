-- Phase 1.1 hardening: short-lived assessment sessions, so the long-lived
-- assessment access token doesn't have to travel in the browser URL (or be
-- resent by the client) for the whole duration of filling out the
-- questionnaire. See domain/assessment/session.ts.
--
-- Same pattern as `assessments.secure_token_hash`: only an HMAC-SHA256
-- digest of the session token is stored, never the raw value. The raw
-- session token lives only in an HttpOnly cookie in the client's browser.
--
-- Same RLS pattern as every other table: no policy grants anon/authenticated
-- (non-admin) access at all. The public flow never queries this table with
-- the anon key — token/session verification happens server-side with the
-- service-role client, which bypasses RLS after application-level
-- verification (see OPEN_QUESTIONS.md on why RLS can't itself compare a
-- hashed claim).

create table assessment_sessions (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments (id) on delete cascade,
  session_token_hash text not null unique,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index assessment_sessions_assessment_id_idx on assessment_sessions (assessment_id);
create index assessment_sessions_session_token_hash_idx on assessment_sessions (session_token_hash);

alter table assessment_sessions enable row level security;

create policy "admin full access to assessment_sessions"
  on assessment_sessions for all
  using (exists (select 1 from admin_profiles where id = auth.uid()))
  with check (exists (select 1 from admin_profiles where id = auth.uid()));
