export type AssessmentStatus =
  | "DRAFT"
  | "ANALYZED"
  | "LAWYER_REVIEW"
  | "APPROVED"
  | "CLIENT_REPORT_RELEASED";

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

export interface AuditEventInput {
  actorType: "admin" | "client" | "system";
  actorId?: string | null;
  assessmentId?: string | null;
  eventType: string;
  metadata?: Record<string, unknown>;
}
