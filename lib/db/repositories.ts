import type {
  Answer,
  AnswerSource,
  Assessment,
  AssessmentStatus,
  AuditEventInput,
  DocumentRecord,
  NewDocumentInput,
  NewOrganizationInput,
  Organization,
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
}

export interface DocumentRepository {
  create(input: NewDocumentInput): Promise<DocumentRecord>;
  listByAssessment(assessmentId: string): Promise<DocumentRecord[]>;
  getById(id: string): Promise<DocumentRecord | null>;
  markDeleted(id: string): Promise<void>;
}

export interface Repositories {
  organizations: OrganizationRepository;
  assessments: AssessmentRepository;
  answers: AnswerRepository;
  audit: AuditRepository;
  documents: DocumentRepository;
}
