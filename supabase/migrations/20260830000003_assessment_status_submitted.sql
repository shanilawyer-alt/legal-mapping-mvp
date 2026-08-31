-- Phase 2: adds the missing "client submitted, not yet analyzed" state.
-- See OPEN_QUESTIONS.md item 11 for why this was necessary — documented
-- there before this migration was written, per instruction. Additive only:
-- does not remove or reorder any existing enum value, does not touch any
-- existing row.
--
-- New workflow: DRAFT -> SUBMITTED -> ANALYZED -> LAWYER_REVIEW -> APPROVED
-- -> CLIENT_REPORT_RELEASED.
--
-- Note: PostgreSQL requires ALTER TYPE ... ADD VALUE to run as its own
-- statement, not combined with other DDL in the same transaction as a use
-- of the new value — hence this is its own migration file.

alter type assessment_status add value 'SUBMITTED' before 'ANALYZED';
