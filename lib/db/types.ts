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
