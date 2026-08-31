import type {
  Answer,
  AnswerSource,
  Assessment,
  AssessmentSession,
  AssessmentStatus,
  AuditEvent,
  AuditEventInput,
  DocumentExtraction,
  DocumentRecord,
  DerivedFact,
  Finding,
  FindingReviewUpdate,
  NewAssessmentSessionInput,
  NewDerivedFactInput,
  NewDocumentExtractionInput,
  NewDocumentInput,
  NewFindingInput,
  NewOrganizationInput,
  NewReportInput,
  NewRuleEvaluationInput,
  Organization,
  Report,
  RuleEvaluation,
} from "@/lib/db/types";

/**
 * Repository interfaces (ports). Two implementations exist:
 *  - lib/db/supabase/repositories.ts — the real Postgres-backed adapter.
 *  - lib/db/inMemory.ts — an in-memory adapter used by unit tests, so
 *    token-isolation and service-layer logic can be proven without a live
 *    Supabase project (none is reachable from this build environment —
 *    see OPEN_QUESTIONS.md #4).
 */

export interface OrganizationRepository {
  create(input: NewOrganizationInput): Promise<Organization>;
  getById(id: string): Promise<Organization | null>;
}

export interface CreateAssessmentInput {
  organizationId: string;
  secureTokenHash: string;
  tokenExpiresAt: Date;
  assessmentVersion: string;
  questionnaireVersion: string;
  ruleEngineVersion: string;
}

export interface AssessmentRepository {
  create(input: CreateAssessmentInput): Promise<Assessment>;
  findByTokenHash(secureTokenHash: string): Promise<Assessment | null>;
  getById(id: string): Promise<Assessment | null>;
  updateStatus(id: string, status: AssessmentStatus): Promise<void>;
  /** Phase 2: admin dashboard listing. */
  listAll(): Promise<Assessment[]>;
  /** Phase 2: DRAFT -> SUBMITTED, sets submitted_at. */
  markSubmitted(id: string, submittedAt: Date): Promise<Assessment>;
  /** Phase 2: SUBMITTED -> DRAFT, clears submitted_at. See OPEN_QUESTIONS.md #16 for scope. */
  reopen(id: string): Promise<Assessment>;
  /** Phase 3: LAWYER_REVIEW -> APPROVED, sets approved_at/approved_by. The unresolved-CRITICAL-findings gate is enforced by the caller (domain/review/approveAssessment.ts), not here. */
  approve(id: string, approvedBy: string, approvedAt: Date): Promise<Assessment>;
}

export interface AnswerRepository {
  upsert(
    assessmentId: string,
    questionId: string,
    valueJson: unknown,
    source: AnswerSource,
  ): Promise<Answer>;
  listByAssessment(assessmentId: string): Promise<Answer[]>;
}

export interface AuditRepository {
  record(event: AuditEventInput): Promise<void>;
  /** Phase 2: admin audit-trail tab. */
  listByAssessment(assessmentId: string): Promise<AuditEvent[]>;
}

export interface DocumentRepository {
  create(input: NewDocumentInput): Promise<DocumentRecord>;
  listByAssessment(assessmentId: string): Promise<DocumentRecord[]>;
  getById(id: string): Promise<DocumentRecord | null>;
  markDeleted(id: string): Promise<void>;
}

export interface AssessmentSessionRepository {
  create(input: NewAssessmentSessionInput): Promise<AssessmentSession>;
  findByTokenHash(sessionTokenHash: string): Promise<AssessmentSession | null>;
}

/** Phase 3. */
export interface DocumentExtractionRepository {
  create(input: NewDocumentExtractionInput): Promise<DocumentExtraction>;
  listByDocument(documentId: string): Promise<DocumentExtraction[]>;
  listByAssessment(assessmentId: string): Promise<DocumentExtraction[]>;
}

/** Phase 3. */
export interface DerivedFactRepository {
  create(input: NewDerivedFactInput): Promise<DerivedFact>;
  listByAssessment(assessmentId: string): Promise<DerivedFact[]>;
}

/** Phase 3. */
export interface RuleEvaluationRepository {
  create(input: NewRuleEvaluationInput): Promise<RuleEvaluation>;
  listByAssessment(assessmentId: string): Promise<RuleEvaluation[]>;
}

/** Phase 3. */
export interface FindingRepository {
  create(input: NewFindingInput): Promise<Finding>;
  listByAssessment(assessmentId: string): Promise<Finding[]>;
  getById(id: string): Promise<Finding | null>;
  /** Attorney review actions only — see FindingReviewUpdate. Sets reviewedBy/reviewedAt. */
  review(id: string, update: FindingReviewUpdate, reviewedBy: string): Promise<Finding>;
}

/** Phase 3. */
export interface ReportRepository {
  create(input: NewReportInput): Promise<Report>;
  listByAssessment(assessmentId: string): Promise<Report[]>;
  getById(id: string): Promise<Report | null>;
}

export interface Repositories {
  organizations: OrganizationRepository;
  assessments: AssessmentRepository;
  answers: AnswerRepository;
  audit: AuditRepository;
  documents: DocumentRepository;
  assessmentSessions: AssessmentSessionRepository;
  documentExtractions: DocumentExtractionRepository;
  derivedFacts: DerivedFactRepository;
  ruleEvaluations: RuleEvaluationRepository;
  findings: FindingRepository;
  reports: ReportRepository;
}
