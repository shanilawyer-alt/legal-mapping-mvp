# Legal Mapping MVP — Master Build Specification

## 0. Purpose
Build a secure, Hebrew-first, RTL web application for an attorney-supervised legal-risk mapping of businesses in:
1. Employment law.
2. Workplace privacy / employee data protection.
3. Freelancer / independent-contractor classification risk.

The app collects structured factual information, accepts supporting documents, extracts structured facts using AI, cross-checks sources, executes a deterministic attorney-defined legal Rule Engine, creates draft findings, and requires lawyer review before any client-facing report is released.

The accompanying CSV files are authoritative V1 source material. Do not invent or silently alter legal rules, question IDs, severity levels, or conclusions.

## 1. Core product principles
### 1.1 Facts first; law second
Ask clients factual operational questions rather than questions requiring legal knowledge.
AI extracts facts. Deterministic rules apply attorney-defined legal logic.

### 1.2 AI is not the final legal decision-maker
AI may extract clauses, classify text into pre-defined categories, identify contradictions, return structured fields, cite page/section evidence, and flag ambiguity.
AI must not independently invent legal rules, determine that a freelancer is legally an employee, declare an agreement lawful/unlawful, change severity, or release a client report.

### 1.3 Mandatory attorney review
Workflow:
`DRAFT -> ANALYZED -> LAWYER_REVIEW -> APPROVED -> CLIENT_REPORT_RELEASED`

### 1.4 Traceability
Every finding must be traceable to Rule ID, questionnaire inputs, documents, extracted facts, legal source, Rule Engine version, AI extraction model/version, and attorney review action.

## 2. Roles
### Client respondent
No permanent account required for V1. Use a secure expiring assessment link with a random token, optional OTP/email verification, autosave and save-and-return. A client may access only her assessment.

### Attorney/Admin
Authenticated. Can create assessments, issue links, view progress, answers and documents, run/re-run analysis, inspect evidence, confirm/modify/dismiss findings, override severity with a mandatory reason, hide findings from client, approve, generate reports and delete/archive subject to retention policy.

## 3. Preferred stack
Use current stable versions:
- Next.js App Router
- TypeScript strict mode
- React
- PostgreSQL via Supabase
- Supabase Auth for admin
- private Supabase Storage (or equivalent)
- Row Level Security
- server-side privileged operations
- Zod validation
- provider-abstracted AI layer (Anthropic and/or OpenAI)
- server-side document parsing
- PDF report generation
- unit + E2E tests

Do not couple the Rule Engine to an AI vendor.

## 4. Suggested repository structure
```text
/app
  /(public)/assessment/[token]
  /(admin)/admin
  /(admin)/admin/assessments/[id]
  /api/assessments
  /api/documents
  /api/analysis
  /api/reports
/components
  /assessment
  /admin
  /findings
  /documents
/domain
  /questionnaire
  /rules
  /documents
  /reports
/lib
  /ai
  /db
  /security
  /audit
/data
/scripts
/tests
```

## 5. Database model
Create migrations for:

### organizations
- id UUID PK
- legal_name
- business_type
- industry
- branch_count
- current_employee_count
- former_employee_count_12m
- freelancer_count
- timestamps

Business form is context, not a generic risk multiplier.

### assessments
- id UUID PK
- organization_id FK
- status
- assessment_version
- questionnaire_version
- rule_engine_version
- secure_token_hash
- token_expires_at
- submitted_at
- approved_at
- approved_by
- timestamps

Never store raw secure tokens.

### answers
- id
- assessment_id
- question_id
- value_json JSONB
- source: client | attorney | derived
- answered_at

### documents
- id
- assessment_id
- document_type
- private storage_path
- original_filename
- mime_type
- size_bytes
- sha256
- upload_status
- uploaded_at
- deleted_at

### document_extractions
- id
- document_id
- schema_name/version
- provider/model
- extraction_json
- confidence_json
- evidence_json
- status
- created_at

### derived_facts
- id
- assessment_id
- fact_key
- value_json
- source_type/source_id
- confidence
- created_at

Examples:
`contract.overtime.type = global`
`contract.overtime.hours = 20`
`payslip.global_overtime.amount = 2500`
`attendance.actual_overtime_hours = 34`

### rule_evaluations
- id
- assessment_id
- rule_id/version
- matched
- input_snapshot
- base_severity
- scope_points
- duration_points
- systemic_points
- dispute_points
- override_critical
- risk_score
- risk_level
- confidence
- created_at

### findings
- id
- assessment_id
- rule_evaluation_id
- category/sub_category
- internal_title/client_title
- draft_internal_text/draft_client_text
- recommended_action
- risk_score/risk_level
- confidence
- status: draft | confirmed | modified | dismissed
- visible_to_client
- lawyer_notes
- severity_override
- override_reason
- reviewed_by/reviewed_at
- timestamps

### reports
- id
- assessment_id
- report_type: internal | client
- version
- storage_path
- generated_by/generated_at

### audit_events
Audit login, link creation, document access, analysis, finding override, approval, report generation and deletion.
Never put document contents or sensitive extracted values in ordinary logs.

## 6. Questionnaire Engine
`questionnaire.csv` is authoritative V1.
Preserve IDs, modules, Hebrew wording, answer types, options, triggers, follow-ups, document requests and internal notes.

Client UI:
- Hebrew-first
- `<html lang="he" dir="rtl">`
- mobile-friendly
- accessible
- section-based progress
- autosave
- back/next
- optional uploads can be skipped

Branching examples:
- `GEN-06 > 0` opens freelancers.
- `PRIV-08 = yes` opens cameras.
- biometric attendance derives biometric-use facts.
- `GEN-04 > 25` opens the relevant customized sexual-harassment regulation question.

Do not show “103 questions”. For a simple small business, target perceived completion of about 10–15 minutes.

## 7. Document uploads
Pilot formats: PDF, DOCX, JPG/PNG; XLSX/CSV when appropriate.
Requirements:
- private bucket
- signed short-lived URLs
- no public object URLs
- reasonable size limit
- malware scanning if available
- no file content in app logs

Before upload, show a Hebrew redaction notice asking clients to remove unnecessary names, ID numbers, bank details, medical data and other irrelevant personal data.

## 8. Document extraction
Use `document_analysis_matrix.csv`.
All extraction uses strict structured schemas and evidence.

### Employment agreement
Extract:
- employment type
- start date
- job title
- salary and basis
- weekly hours/work days
- overtime type/amount/hours
- notice period
- Section 14 reference/scope
- severance contribution rate
- pension
- study fund
- bonus/commission
- trust-position clause
- privacy/monitoring clauses
- evidence by page/section

AI extracts presence/absence of configured facts. The Rule Engine determines legal significance.

### Payslip
Extract base salary, regular hours, overtime 125/150, global overtime, bonus, commission, pension employee/employer, severance, study fund, vacation/sick balances, pay period and evidence.

### Attendance
Extract period, regular hours, actual overtime, night hours, Saturday/holiday hours, breaks where available and evidence.

### Freelancer agreement
Extract term, payment model, exclusivity, personal performance, substitution, control of hours, location, equipment, supervision, termination, benefits, company email/systems, contractor-status wording and evidence.
“Independent contractor” is a fact, not a legal conclusion.

### Employee privacy notice/policy
Extract data categories, purposes, mandatory/voluntary wording, controller identity/contact, recipients, rights, cameras, monitoring, biometrics, retention and evidence.

## 9. AI abstraction
Create a provider interface. Calls are server-side only. Validate structured outputs with Zod. Store provider/model/schema version. Minimize personal data. Do not send unrelated assessment data.

## 10. Cross-check engine
Cross-checking is separate from legal-rule evaluation.

### Employee notice
If `EMP-02 = no` and an agreement exists, do not create an automatic violation. Run agreement-coverage extraction and derive a fact requiring contract coverage check.

### Global overtime
Compare agreement, payslip, attendance and answers.
Possible facts:
- global clause exists
- payslip component exists
- actual overtime exceeds contractual assumption
- contract/payslip mismatch

### Privacy contradiction
If client says no monitoring but a policy/system document shows GPS/location collection:
- create a neutral contradiction record
- derive location-monitoring fact
- do not accuse the client of falsehood

### Freelancers
Aggregate factual indicators only. Do not determine legal status.

## 11. Rule Engine
`rule_catalog.csv` is authoritative.
Rules must be deterministic, versioned, testable and independent of AI prompts.
Never use JavaScript `eval()`. Build a safe typed condition evaluator or translate CSV rules into typed code.
Store exact input snapshots for every evaluation.

## 12. Risk scoring
Risk score is a prioritization mechanism, not probability of liability.

Base severity:
1=10, 2=20, 3=30, 4=40, 5=50.

### Scope — corrected V1 rule
Calculate both absolute and percentage buckets, then use the higher:
Absolute:
- 1 employee = 5
- 2–5 = 10
- 6–20 = 15
- >20 = 20
Percentage:
- <=10% = 5
- >10–25% = 10
- >25–50% = 15
- >50% = 20
`scopePoints = max(absoluteBucket, percentageBucket)`

If total employee count is unknown, use the absolute bucket and lower confidence.

Duration:
- <3 months = 2
- 3–11 = 4
- 12–35 = 7
- >=36 = 10

Systemic:
- isolated 0
- repeated 5
- policy/systemic 10

Active dispute:
- none 0
- complaint/dispute 5
- demand letter/court/administrative process 10

`riskScore = min(100, base + scope + duration + systemic + dispute)`

Bands:
- 0–24 LOW
- 25–44 MEDIUM
- 45–64 SIGNIFICANT
- 65–79 HIGH
- 80–100 CRITICAL

If `criticalOverride=true`, risk level is CRITICAL regardless of numeric score.

### Confidence is separate
1/4 self-report only
2/4 two consistent sources
3/4 documentary evidence
4/4 document + operational cross-check

Confidence must never increase risk.

## 13. Freelancer screening
Use `freelancer_screening_model.csv`.
It is screening only. Output LOW/MEDIUM/SIGNIFICANT/HIGH.
Mandatory wording:
"The screening score reflects accumulated factual indicators and does not determine the legal status of the service provider."
Show attorney which indicators contributed.

## 14. Employee count/business form
Do not score a limited company higher merely because it is a company.
Employee count affects scope and rule-specific statutory thresholds.
Business form is used only where legally relevant to a specific rule/context.

## 15. Lawyer review screen
Display:
- finding
- category
- Rule ID
- risk score/level
- confidence
- affected count/percentage
- duration
- triggering answers
- extracted facts
- evidence page/section
- legal source
- AI draft internal/client wording
- recommendation
- internal service opportunity

Actions:
Confirm / Modify / Dismiss / Override severity (reason required) / Add note / Visible-to-client toggle.

An assessment cannot be approved with unresolved CRITICAL findings in draft.

## 16. Reports
Use `report_structure.csv`.

Client report in Hebrew RTL:
1. Cover
2. Executive summary
3. Domain map
4. Priority findings
5. Action plan: immediate / 30 days / process improvement
6. Scope and limitations

For each finding:
- title
- risk level
- what was identified
- why it matters, briefly
- recommended action

Do not expose Rule IDs, score formula, internal notes or commercial fields.

Internal report includes all answers, documents, extracted facts, contradictions, Rule IDs, scores, confidence, legal sources, lawyer notes and audit.

## 17. Security/privacy
- data minimization
- encourage redacted documents
- no unnecessary employee identity data
- TLS
- private storage
- RLS
- short-lived signed URLs
- server-side secrets
- never commit secrets
- no raw documents in logs
- configurable retention (do not hard-code a legal period)
- admin delete/archive
- synthetic fixtures only in development

## 18. Legal-source management
Use `legal_sources.csv`.
Rules may reference source title, URL and update date.
Do not dynamically scrape or silently “update the law” during V1 evaluation.
All legal-rule changes require a versioned, attorney-reviewed update.
Maintain `RULE_ENGINE_VERSION`, `LEGAL_SOURCE_SET_VERSION` and a changelog.

## 19. Wording controls
Prefer:
- identified
- possible exposure
- requires legal review
- inconsistency identified
- screening indicates

Avoid autonomous definitive wording such as:
- you violated the law
- this freelancer is an employee
- your company is non-compliant
unless explicitly approved by the attorney.

## 20. MVP screens
Public:
- assessment introduction
- secure start
- business profile
- employment documents
- pay/time
- social rights
- termination/HR
- freelancers if triggered
- workplace privacy
- uploads
- review
- submission confirmation

Admin:
- login
- assessment list
- create assessment
- overview
- answers
- documents
- extracted facts
- findings
- lawyer review
- reports
- audit trail

## 21. Acceptance criteria
Questionnaire:
- secure assessment creation
- Hebrew RTL
- core branching
- autosave
- locked after submission unless reopened

Documents:
- private upload
- admin view
- strict extraction schemas for agreement, payslip, attendance, freelancer agreement and privacy policy

Minimum cross-check demonstrations:
1. no employee notice + agreement uploaded -> contract coverage check, not automatic violation
2. global overtime contract/payslip/attendance mismatch
3. accumulated freelancer indicators
4. questionnaire says no monitoring but document shows GPS/location collection

Rule Engine:
- versioned source
- deterministic tests for implemented rules
- corrected scope scoring
- confidence separate
- critical override works

Review:
- mandatory lawyer review
- confirm/modify/dismiss
- override reason required
- no client report before approval

Security:
- verified RLS
- token isolation
- private files
- no browser secrets
- no real personal data in tests

## 22. Synthetic test fixtures
A. Small business: 3 employees, no freelancers/cameras, agreements exist.
B. Working-time exposure: 20 employees, 8 affected, global clause 20 hours, attendance 34 hours, 18 months.
C. Privacy exposure: 20 employees, cameras, highly sensitive-area test fixture, inadequate notice.
D. Freelancer: no other clients, fixed hours, personal performance, company equipment/email, manager, leave approval. Expected significant/high screening but no legal-status determination.

## 23. Build sequence
Phase 1 — foundation: scaffold, migrations, auth, security, CSV imports, questionnaire renderer, token links.
Phase 2 — client pilot: branching, autosave, uploads, submission, admin viewer.
Phase 3 — deterministic Rule Engine and tests, before broad AI.
Phase 4 — document extraction/evidence.
Phase 5 — cross-checks and re-evaluation.
Phase 6 — lawyer review and PDF reports.
Phase 7 — security/accessibility/RTL/E2E/deployment hardening.

At the end of each phase:
- run tests/typecheck
- summarize changes
- list unresolved issues
- never silently change legal source data

## 24. Instructions to Claude Code
1. Read this specification fully.
2. Read all CSV files before implementing business logic.
3. Treat IDs and V1 legal logic as source of truth.
4. Do not remove the lawyer-review gate.
5. Do not create a generic AI legal-advice chatbot.
6. Do not send client documents to AI until private upload/security and user notice exist.
7. Use synthetic data during development.
8. Implement deterministic tests before broad AI functionality.
9. If ambiguous, choose the safer implementation and log it in `OPEN_QUESTIONS.md`; do not invent legal rules.
10. Keep legal logic versioned and auditable.
