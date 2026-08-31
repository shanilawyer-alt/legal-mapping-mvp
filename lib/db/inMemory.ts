import { randomUUID } from "node:crypto";
import type {
  Answer,
  AnswerSource,
  Assessment,
  AssessmentSession,
  AssessmentStatus,
  AuditEvent,
  AuditEventInput,
  DerivedFact,
  DocumentExtraction,
  DocumentRecord,
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
import type {
  AnswerRepository,
  AssessmentRepository,
  AssessmentSessionRepository,
  AuditRepository,
  CreateAssessmentInput,
  DerivedFactRepository,
  DocumentExtractionRepository,
  DocumentRepository,
  FindingRepository,
  OrganizationRepository,
  ReportRepository,
  Repositories,
  RuleEvaluationRepository,
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
  const documentExtractions = new Map<string, DocumentExtraction>();
  const derivedFacts = new Map<string, DerivedFact>();
  const ruleEvaluations = new Map<string, RuleEvaluation>();
  const findings = new Map<string, Finding>();
  const reports = new Map<string, Report>();

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
    async approve(id: string, approvedBy: string, approvedAt: Date): Promise<Assessment> {
      const assessment = assessments.get(id);
      if (!assessment) throw new Error(`Assessment ${id} not found`);
      const updated: Assessment = {
        ...assessment,
        status: "APPROVED",
        approvedAt: approvedAt.toISOString(),
        approvedBy,
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

  const documentExtractionRepo: DocumentExtractionRepository = {
    async create(input: NewDocumentExtractionInput): Promise<DocumentExtraction> {
      const record: DocumentExtraction = {
        id: randomUUID(),
        documentId: input.documentId,
        schemaName: input.schemaName,
        schemaVersion: input.schemaVersion,
        provider: input.provider,
        model: input.model,
        extractionJson: input.extractionJson,
        confidenceJson: input.confidenceJson,
        evidenceJson: input.evidenceJson,
        status: input.status,
        createdAt: new Date().toISOString(),
      };
      documentExtractions.set(record.id, record);
      return record;
    },
    async listByDocument(documentId: string): Promise<DocumentExtraction[]> {
      return [...documentExtractions.values()].filter((e) => e.documentId === documentId);
    },
    async listByAssessment(assessmentId: string): Promise<DocumentExtraction[]> {
      const docIds = new Set(
        [...documents.values()].filter((d) => d.assessmentId === assessmentId).map((d) => d.id),
      );
      return [...documentExtractions.values()].filter((e) => docIds.has(e.documentId));
    },
  };

  const derivedFactRepo: DerivedFactRepository = {
    async create(input: NewDerivedFactInput): Promise<DerivedFact> {
      const fact: DerivedFact = {
        id: randomUUID(),
        assessmentId: input.assessmentId,
        factKey: input.factKey,
        valueJson: input.valueJson,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        confidence: input.confidence ?? null,
        createdAt: new Date().toISOString(),
      };
      derivedFacts.set(fact.id, fact);
      return fact;
    },
    async listByAssessment(assessmentId: string): Promise<DerivedFact[]> {
      return [...derivedFacts.values()].filter((f) => f.assessmentId === assessmentId);
    },
  };

  const ruleEvaluationRepo: RuleEvaluationRepository = {
    async create(input: NewRuleEvaluationInput): Promise<RuleEvaluation> {
      const evaluation: RuleEvaluation = {
        id: randomUUID(),
        assessmentId: input.assessmentId,
        ruleId: input.ruleId,
        ruleVersion: input.ruleVersion,
        matched: input.matched,
        inputSnapshot: input.inputSnapshot,
        baseSeverity: input.baseSeverity,
        scopePoints: input.scopePoints,
        durationPoints: input.durationPoints,
        systemicPoints: input.systemicPoints,
        disputePoints: input.disputePoints,
        overrideCritical: input.overrideCritical,
        riskScore: input.riskScore,
        riskLevel: input.riskLevel,
        confidence: input.confidence ?? null,
        createdAt: new Date().toISOString(),
      };
      ruleEvaluations.set(evaluation.id, evaluation);
      return evaluation;
    },
    async listByAssessment(assessmentId: string): Promise<RuleEvaluation[]> {
      return [...ruleEvaluations.values()].filter((e) => e.assessmentId === assessmentId);
    },
  };

  const findingRepo: FindingRepository = {
    async create(input: NewFindingInput): Promise<Finding> {
      const now = new Date().toISOString();
      const finding: Finding = {
        id: randomUUID(),
        assessmentId: input.assessmentId,
        ruleEvaluationId: input.ruleEvaluationId ?? null,
        category: input.category,
        subCategory: input.subCategory ?? null,
        internalTitle: input.internalTitle,
        clientTitle: input.clientTitle ?? null,
        draftInternalText: input.draftInternalText ?? null,
        draftClientText: input.draftClientText ?? null,
        recommendedAction: input.recommendedAction ?? null,
        riskScore: input.riskScore ?? null,
        riskLevel: input.riskLevel ?? null,
        confidence: input.confidence ?? null,
        status: "draft",
        visibleToClient: false,
        lawyerNotes: null,
        severityOverride: null,
        overrideReason: null,
        reviewedBy: null,
        reviewedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      findings.set(finding.id, finding);
      return finding;
    },
    async listByAssessment(assessmentId: string): Promise<Finding[]> {
      return [...findings.values()].filter((f) => f.assessmentId === assessmentId);
    },
    async getById(id: string): Promise<Finding | null> {
      return findings.get(id) ?? null;
    },
    async review(id: string, update: FindingReviewUpdate, reviewedBy: string): Promise<Finding> {
      const finding = findings.get(id);
      if (!finding) throw new Error(`Finding ${id} not found`);
      if (update.severityOverride != null && !update.overrideReason) {
        throw new Error("override_requires_reason");
      }
      const updated: Finding = {
        ...finding,
        ...update,
        reviewedBy,
        reviewedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      findings.set(id, updated);
      return updated;
    },
  };

  const reportRepo: ReportRepository = {
    async create(input: NewReportInput): Promise<Report> {
      const report: Report = {
        id: randomUUID(),
        assessmentId: input.assessmentId,
        reportType: input.reportType,
        version: input.version,
        storagePath: input.storagePath,
        generatedBy: input.generatedBy ?? null,
        generatedAt: new Date().toISOString(),
      };
      reports.set(report.id, report);
      return report;
    },
    async listByAssessment(assessmentId: string): Promise<Report[]> {
      return [...reports.values()].filter((r) => r.assessmentId === assessmentId);
    },
    async getById(id: string): Promise<Report | null> {
      return reports.get(id) ?? null;
    },
  };

  return {
    organizations: organizationRepo,
    assessments: assessmentRepo,
    answers: answerRepo,
    audit: auditRepo,
    documents: documentRepo,
    assessmentSessions: assessmentSessionRepo,
    documentExtractions: documentExtractionRepo,
    derivedFacts: derivedFactRepo,
    ruleEvaluations: ruleEvaluationRepo,
    findings: findingRepo,
    reports: reportRepo,
  };
}
