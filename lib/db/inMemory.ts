import { randomUUID } from "node:crypto";
import type {
  Answer,
  AnswerSource,
  Assessment,
  AssessmentSession,
  AssessmentStatus,
  AuditEvent,
  AuditEventInput,
  DocumentRecord,
  NewAssessmentSessionInput,
  NewDocumentInput,
  NewOrganizationInput,
  Organization,
} from "@/lib/db/types";
import type {
  AnswerRepository,
  AssessmentRepository,
  AssessmentSessionRepository,
  AuditRepository,
  CreateAssessmentInput,
  DocumentRepository,
  OrganizationRepository,
  Repositories,
} from "@/lib/db/repositories";

/**
 * In-memory implementation of every repository port, used by unit tests
 * (see tests/token-isolation.test.ts). Behaves like the real adapter for
 * the invariants tests care about: unique secure_token_hash, answers
 * scoped strictly by assessment_id, no cross-assessment leakage.
 */
export function createInMemoryRepositories(): Repositories {
  const organizations = new Map<string, Organization>();
  const assessments = new Map<string, Assessment>();
  const answersByAssessment = new Map<string, Map<string, Answer>>();
  const documents = new Map<string, DocumentRecord>();
  const sessions = new Map<string, AssessmentSession>();
  const auditLog: AuditEvent[] = [];

  const organizationRepo: OrganizationRepository = {
    async create(input: NewOrganizationInput): Promise<Organization> {
      const now = new Date().toISOString();
      const org: Organization = {
        id: randomUUID(),
        legalName: input.legalName,
        businessType: input.businessType ?? null,
        industry: input.industry ?? null,
        branchCount: input.branchCount ?? null,
        currentEmployeeCount: input.currentEmployeeCount ?? null,
        formerEmployeeCount12m: input.formerEmployeeCount12m ?? null,
        freelancerCount: input.freelancerCount ?? null,
        createdAt: now,
        updatedAt: now,
      };
      organizations.set(org.id, org);
      return org;
    },
    async getById(id: string): Promise<Organization | null> {
      return organizations.get(id) ?? null;
    },
  };

  const assessmentRepo: AssessmentRepository = {
    async create(input: CreateAssessmentInput): Promise<Assessment> {
      const existing = [...assessments.values()].find(
        (a) => a.secureTokenHash === input.secureTokenHash,
      );
      if (existing) {
        throw new Error("secure_token_hash must be unique");
      }
      const now = new Date().toISOString();
      const assessment: Assessment = {
        id: randomUUID(),
        organizationId: input.organizationId,
        status: "DRAFT",
        assessmentVersion: input.assessmentVersion,
        questionnaireVersion: input.questionnaireVersion,
        ruleEngineVersion: input.ruleEngineVersion,
        secureTokenHash: input.secureTokenHash,
        tokenExpiresAt: input.tokenExpiresAt.toISOString(),
        submittedAt: null,
        approvedAt: null,
        approvedBy: null,
        retentionDays: null,
        createdAt: now,
        updatedAt: now,
      };
      assessments.set(assessment.id, assessment);
      answersByAssessment.set(assessment.id, new Map());
      return assessment;
    },
    async findByTokenHash(secureTokenHash: string): Promise<Assessment | null> {
      return (
        [...assessments.values()].find((a) => a.secureTokenHash === secureTokenHash) ?? null
      );
    },
    async getById(id: string): Promise<Assessment | null> {
      return assessments.get(id) ?? null;
    },
    async updateStatus(id: string, status: AssessmentStatus): Promise<void> {
      const assessment = assessments.get(id);
      if (!assessment) throw new Error(`Assessment ${id} not found`);
      assessments.set(id, { ...assessment, status, updatedAt: new Date().toISOString() });
    },
    async listAll(): Promise<Assessment[]> {
      return [...assessments.values()];
    },
    async markSubmitted(id: string, submittedAt: Date): Promise<Assessment> {
      const assessment = assessments.get(id);
      if (!assessment) throw new Error(`Assessment ${id} not found`);
      const updated: Assessment = {
        ...assessment,
        status: "SUBMITTED",
        submittedAt: submittedAt.toISOString(),
        updatedAt: new Date().toISOString(),
      };
      assessments.set(id, updated);
      return updated;
    },
    async reopen(id: string): Promise<Assessment> {
      const assessment = assessments.get(id);
      if (!assessment) throw new Error(`Assessment ${id} not found`);
      const updated: Assessment = {
        ...assessment,
        status: "DRAFT",
        submittedAt: null,
        updatedAt: new Date().toISOString(),
      };
      assessments.set(id, updated);
      return updated;
    },
  };

  const answerRepo: AnswerRepository = {
    async upsert(
      assessmentId: string,
      questionId: string,
      valueJson: unknown,
      source: AnswerSource,
    ): Promise<Answer> {
      const bucket = answersByAssessment.get(assessmentId);
      if (!bucket) throw new Error(`Assessment ${assessmentId} not found`);
      const answer: Answer = {
        id: bucket.get(questionId)?.id ?? randomUUID(),
        assessmentId,
        questionId,
        valueJson,
        source,
        answeredAt: new Date().toISOString(),
      };
      bucket.set(questionId, answer);
      return answer;
    },
    async listByAssessment(assessmentId: string): Promise<Answer[]> {
      const bucket = answersByAssessment.get(assessmentId);
      return bucket ? [...bucket.values()] : [];
    },
  };

  const auditRepo: AuditRepository = {
    async record(event: AuditEventInput): Promise<void> {
      auditLog.push({
        id: randomUUID(),
        actorType: event.actorType,
        actorId: event.actorId ?? null,
        assessmentId: event.assessmentId ?? null,
        eventType: event.eventType,
        metadataJson: event.metadata ?? {},
        createdAt: new Date().toISOString(),
      });
    },
    async listByAssessment(assessmentId: string): Promise<AuditEvent[]> {
      return auditLog.filter((e) => e.assessmentId === assessmentId);
    },
  };

  const documentRepo: DocumentRepository = {
    async create(input: NewDocumentInput): Promise<DocumentRecord> {
      const record: DocumentRecord = {
        id: randomUUID(),
        assessmentId: input.assessmentId,
        documentType: input.documentType,
        storagePath: input.storagePath,
        originalFilename: input.originalFilename,
        mimeType: input.mimeType,
        sizeBytes: input.sizeBytes,
        sha256: input.sha256,
        uploadStatus: input.uploadStatus,
        uploadedAt: new Date().toISOString(),
        deletedAt: null,
      };
      documents.set(record.id, record);
      return record;
    },
    async listByAssessment(assessmentId: string): Promise<DocumentRecord[]> {
      return [...documents.values()].filter((d) => d.assessmentId === assessmentId);
    },
    async getById(id: string): Promise<DocumentRecord | null> {
      return documents.get(id) ?? null;
    },
    async markDeleted(id: string): Promise<void> {
      const doc = documents.get(id);
      if (!doc) throw new Error(`Document ${id} not found`);
      documents.set(id, { ...doc, uploadStatus: "deleted", deletedAt: new Date().toISOString() });
    },
  };

  const assessmentSessionRepo: AssessmentSessionRepository = {
    async create(input: NewAssessmentSessionInput): Promise<AssessmentSession> {
      const existing = [...sessions.values()].find(
        (s) => s.sessionTokenHash === input.sessionTokenHash,
      );
      if (existing) {
        throw new Error("session_token_hash must be unique");
      }
      const session: AssessmentSession = {
        id: randomUUID(),
        assessmentId: input.assessmentId,
        sessionTokenHash: input.sessionTokenHash,
        expiresAt: input.expiresAt.toISOString(),
        createdAt: new Date().toISOString(),
      };
      sessions.set(session.id, session);
      return session;
    },
    async findByTokenHash(sessionTokenHash: string): Promise<AssessmentSession | null> {
      return (
        [...sessions.values()].find((s) => s.sessionTokenHash === sessionTokenHash) ?? null
      );
    },
  };

  return {
    organizations: organizationRepo,
    assessments: assessmentRepo,
    answers: answerRepo,
    audit: auditRepo,
    documents: documentRepo,
    assessmentSessions: assessmentSessionRepo,
  };
}
