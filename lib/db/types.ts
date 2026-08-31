export type AssessmentStatus =
  | "DRAFT"
  | "SUBMITTED"
  | "ANALYZED"
  | "LAWYER_REVIEW"
  | "APPROVED"
  | "CLIENT_REPORT_RELEASED";

/** Only DRAFT accepts client answer/document writes — see domain/assessment/session.ts. */
export const EDITABLE_ASSESSMENT_STATUSES: readonly AssessmentStatus[] = ["DRAFT"];

export type AnswerSource = "client" | "attorney" | "derived";

export interface Organization {
  id: string;
  legalName: string;
  businessType: string | null;
  industry: string | null;
  branchCount: number | null;
  currentEmployeeCount: number | null;
  formerEmployeeCount12m: number | null;
  freelancerCount: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Assessment {
  id: string;
  organizationId: string;
  status: AssessmentStatus;
  assessmentVersion: string;
  questionnaireVersion: string;
  ruleEngineVersion: string;
  /** HMAC-SHA256 digest of the raw token. The raw token is never stored. */
  secureTokenHash: string;
  tokenExpiresAt: string;
  submittedAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  /**
   * `null` means "retention policy not yet configured by an attorney" —
   * NOT "retain indefinitely by design." There is no automatic deletion
   * job in Phase 1 regardless of this value; deletion remains a manual
   * admin action either way. Do not treat `null` as an intentional
   * indefinite-retention decision anywhere this field is read.
   */
  retentionDays: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface Answer {
  id: string;
  assessmentId: string;
  questionId: string;
  valueJson: unknown;
  source: AnswerSource;
  answeredAt: string;
}

export interface NewOrganizationInput {
  legalName: string;
  businessType?: string | null;
  industry?: string | null;
  branchCount?: number | null;
  currentEmployeeCount?: number | null;
  formerEmployeeCount12m?: number | null;
  freelancerCount?: number | null;
}

export type DocumentUploadStatus = "pending" | "uploaded" | "failed" | "deleted";

export interface DocumentRecord {
  id: string;
  assessmentId: string;
  documentType: string; // e.g. "DOC-01", matches document_analysis_matrix.csv "ID"
  storagePath: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadStatus: DocumentUploadStatus;
  uploadedAt: string;
  deletedAt: string | null;
}

export interface NewDocumentInput {
  assessmentId: string;
  documentType: string;
  storagePath: string;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
  uploadStatus: DocumentUploadStatus;
}

/**
 * A short-lived session minted after an assessment token is first
 * resolved (see domain/assessment/session.ts). Only its hash is
 * persisted, mirroring `Assessment.secureTokenHash`.
 */
export interface AssessmentSession {
  id: string;
  assessmentId: string;
  sessionTokenHash: string;
  expiresAt: string;
  createdAt: string;
}

export interface NewAssessmentSessionInput {
  assessmentId: string;
  sessionTokenHash: string;
  expiresAt: Date;
}

export interface AuditEventInput {
  actorType: "admin" | "client" | "system";
  actorId?: string | null;
  assessmentId?: string | null;
  eventType: string;
  metadata?: Record<string, unknown>;
}

/** A persisted audit_events row (Phase 2: read side, for the admin audit-trail tab). */
export interface AuditEvent {
  id: string;
  actorType: "admin" | "client" | "system";
  actorId: string | null;
  assessmentId: string | null;
  eventType: string;
  metadataJson: Record<string, unknown>;
  createdAt: string;
}

// ---------------------------------------------------------------------
// Phase 3: document_extractions, derived_facts, rule_evaluations,
// findings, reports — all five tables already existed in the schema
// since Phase 1 (MASTER_BUILD_SPEC.md §5) but were unused until now.
// ---------------------------------------------------------------------

export type ExtractionStatus = "pending" | "completed" | "failed";

export interface DocumentExtraction {
  id: string;
  documentId: string;
  schemaName: string;
  schemaVersion: string;
  provider: string;
  model: string;
  extractionJson: Record<string, unknown>;
  confidenceJson: Record<string, unknown>;
  evidenceJson: Record<string, unknown>;
  status: ExtractionStatus;
  createdAt: string;
}

export interface NewDocumentExtractionInput {
  documentId: string;
  schemaName: string;
  schemaVersion: string;
  provider: string;
  model: string;
  extractionJson: Record<string, unknown>;
  confidenceJson: Record<string, unknown>;
  evidenceJson: Record<string, unknown>;
  status: ExtractionStatus;
}

/** `sourceType` matches spec §5's own examples: "answer" | "document_extraction" | "cross_check" | "system_derived". */
export type FactSourceType = "answer" | "document_extraction" | "cross_check" | "system_derived";

export interface DerivedFact {
  id: string;
  assessmentId: string;
  factKey: string; // dot-namespaced, e.g. "contract.overtime.type" (spec §5 examples)
  valueJson: unknown;
  sourceType: FactSourceType;
  sourceId: string | null;
  /** 1-4, spec §12's confidence scale. Never used to increase risk. */
  confidence: number | null;
  createdAt: string;
}

export interface NewDerivedFactInput {
  assessmentId: string;
  factKey: string;
  valueJson: unknown;
  sourceType: FactSourceType;
  sourceId?: string | null;
  confidence?: number | null;
}

export type RiskLevel = "LOW" | "MEDIUM" | "SIGNIFICANT" | "HIGH" | "CRITICAL";

export interface RuleEvaluation {
  id: string;
  assessmentId: string;
  ruleId: string; // matches rule_catalog.csv "Rule ID" exactly, e.g. R-EMP-001
  ruleVersion: string;
  matched: boolean;
  inputSnapshot: Record<string, unknown>;
  baseSeverity: number; // 1-5
  scopePoints: number;
  durationPoints: number;
  systemicPoints: number;
  disputePoints: number;
  overrideCritical: boolean;
  riskScore: number; // 0-100
  riskLevel: RiskLevel;
  confidence: number | null;
  createdAt: string;
}

export interface NewRuleEvaluationInput {
  assessmentId: string;
  ruleId: string;
  ruleVersion: string;
  matched: boolean;
  inputSnapshot: Record<string, unknown>;
  baseSeverity: number;
  scopePoints: number;
  durationPoints: number;
  systemicPoints: number;
  disputePoints: number;
  overrideCritical: boolean;
  riskScore: number;
  riskLevel: RiskLevel;
  confidence?: number | null;
}

export type FindingStatus = "draft" | "confirmed" | "modified" | "dismissed";

export interface Finding {
  id: string;
  assessmentId: string;
  ruleEvaluationId: string | null;
  category: string;
  subCategory: string | null;
  internalTitle: string;
  clientTitle: string | null;
  draftInternalText: string | null;
  draftClientText: string | null;
  recommendedAction: string | null;
  riskScore: number | null;
  riskLevel: RiskLevel | null;
  confidence: number | null;
  status: FindingStatus;
  visibleToClient: boolean;
  lawyerNotes: string | null;
  severityOverride: number | null;
  overrideReason: string | null;
  reviewedBy: string | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewFindingInput {
  assessmentId: string;
  ruleEvaluationId?: string | null;
  category: string;
  subCategory?: string | null;
  internalTitle: string;
  clientTitle?: string | null;
  draftInternalText?: string | null;
  draftClientText?: string | null;
  recommendedAction?: string | null;
  riskScore?: number | null;
  riskLevel?: RiskLevel | null;
  confidence?: number | null;
}

/**
 * The mutable subset of a finding an attorney can change during review
 * (spec §15: confirm / modify / dismiss / override severity / note /
 * visible-to-client). `reviewedBy`/`reviewedAt` are set by the repository,
 * not the caller. `severityOverride` requires `overrideReason` — enforced
 * by the DB's own `override_requires_reason` check constraint, mirrored
 * in domain/findings validation so the error surfaces before the query.
 */
export interface FindingReviewUpdate {
  status?: FindingStatus;
  visibleToClient?: boolean;
  lawyerNotes?: string | null;
  severityOverride?: number | null;
  overrideReason?: string | null;
}

export type ReportType = "internal" | "client";

export interface Report {
  id: string;
  assessmentId: string;
  reportType: ReportType;
  version: number;
  storagePath: string;
  generatedBy: string | null;
  generatedAt: string;
}

export interface NewReportInput {
  assessmentId: string;
  reportType: ReportType;
  version: number;
  storagePath: string;
  generatedBy?: string | null;
}
