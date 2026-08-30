-- Private storage bucket for uploaded assessment documents (spec §7).
--
-- The bucket is created with public = false. No storage.objects policy is
-- granted to `anon` or `authenticated` here: all reads/writes go through
-- server-side API routes using the service-role client (which bypasses
-- storage RLS by design), which issue short-lived signed URLs. This keeps
-- one enforcement point (the token-verified API route) instead of trying
-- to also replicate token verification inside a storage policy.

insert into storage.buckets (id, name, public)
values ('assessment-documents', 'assessment-documents', false)
on conflict (id) do nothing;
