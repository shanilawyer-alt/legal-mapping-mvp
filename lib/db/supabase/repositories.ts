import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
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
  NewDerivedFactInput,
  NewDocumentExtractionInput,
  NewAssessmentSessionInput,
  NewDocumentInput,
  NewFindingInput,
  NewOrganizationInput,
  NewReportInput,
  NewRuleEvaluationInput,
  Organization,
  Report,
  RuleEvaluation,
} from "@/lib/db/types";

/** Postgres-backed repository adapters, built on the service-role client. */
export function createSupabaseRepositories(client: SupabaseClient): Repositories {
  const organizations: OrganizationRepository = {
    async create(input: NewOrganizationInput): Promise<Organization> {
      const { data, error } = await client
        .from("organizations")
        .insert({
          legal_name: input.legalName,
          business_type: input.businessType ?? null,
          industry: input.industry ?? null,
          branch_count: input.branchCount ?? null,
          current_employee_count: input.currentEmployeeCount ?? null,
          former_employee_count_12m: input.formerEmployeeCount12m ?? null,
          freelancer_count: input.freelancerCount ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return mapOrganization(data);
    },
    async getById(id: string): Promise<Organization | null> {
      const { data, error } = await client
        .from("organizations")
        .select()
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data ? mapOrganization(data) : null;
    },
  };

  const assessments: AssessmentRepository = {
    async create(input: CreateAssessmentInput): Promise<Assessment> {
      const { data, error } = await client
        .from("assessments")
        .insert({
          organization_id: input.organizationId,
          secure_token_hash: input.secureTokenHash,
          token_expires_at: input.tokenExpiresAt.toISOString(),
          assessment_version: input.assessmentVersion,
          questionnaire_version: input.questionnaireVersion,
          rule_engine_version: input.ruleEngineVersion,
        })
        .select()
        .single();
      if (error) throw error;
      return mapAssessment(data);
    },
    async findByTokenHash(secureTokenHash: string): Promise<Assessment | null> {
      const { data, error } = await client
        .from("assessments")
        .select()
        .eq("secure_token_hash", secureTokenHash)
        .maybeSingle();
      if (error) throw error;
      return data ? mapAssessment(data) : null;
    },
    async getById(id: string): Promise<Assessment | null> {
      const { data, error } = await client
        .from("assessments")
        .select()
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data ? mapAssessment(data) : null;
    },
    async updateStatus(id: string, status: AssessmentStatus): Promise<void> {
      const { error } = await client.from("assessments").update({ status }).eq("id", id);
      if (error) throw error;
    },
    async listAll(): Promise<Assessment[]> {
      const { data, error } = await client
        .from("assessments")
        .select()
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []).map(mapAssessment);
    },
    async markSubmitted(id: string, submittedAt: Date): Promise<Assessment> {
      const { data, error } = await client
        .from("assessments")
        .update({ status: "SUBMITTED", submitted_at: submittedAt.toISOString() })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return mapAssessment(data);
    },
    async reopen(id: string): Promise<Assessment> {
      const { data, error } = await client
        .from("assessments")
        .update({ status: "DRAFT", submitted_at: null })
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return mapAssessment(data);
    },
  };

  const answers: AnswerRepository = {
    async upsert(
      assessmentId: string,
      questionId: string,
      valueJson: unknown,
      source: AnswerSource,
    ): Promise<Answer> {
      const { data, error } = await client
        .from("answers")
        .upsert(
          {
            assessment_id: assessmentId,
            question_id: questionId,
            value_json: valueJson,
            source,
            answered_at: new Date().toISOString(),
          },
          { onConflict: "assessment_id,question_id" },
        )
        .select()
        .single();
      if (error) throw error;
      return mapAnswer(data);
    },
    async listByAssessment(assessmentId: string): Promise<Answer[]> {
      const { data, error } = await client
        .from("answers")
        .select()
        .eq("assessment_id", assessmentId);
      if (error) throw error;
      return (data ?? []).map(mapAnswer);
    },
  };

  const audit: AuditRepository = {
    async record(event: AuditEventInput): Promise<void> {
      const { error } = await client.from("audit_events").insert({
        actor_type: event.actorType,
        actor_id: event.actorId ?? null,
        assessment_id: event.assessmentId ?? null,
        event_type: event.eventType,
        metadata_json: event.metadata ?? {},
      });
      if (error) throw error;
    },
    async listByAssessment(assessmentId: string): Promise<AuditEvent[]> {
      const { data, error } = await client
        .from("audit_events")
        .select()
        .eq("assessment_id", assessmentId)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []).map(mapAuditEvent);
    },
  };

  const documents: DocumentRepository = {
    async create(input: NewDocumentInput): Promise<DocumentRecord> {
      const { data, error } = await client
        .from("documents")
        .insert({
          assessment_id: input.assessmentId,
          document_type: input.documentType,
          storage_path: input.storagePath,
          original_filename: input.originalFilename,
          mime_type: input.mimeType,
          size_bytes: input.sizeBytes,
          sha256: input.sha256,
          upload_status: input.uploadStatus,
        })
        .select()
        .single();
      if (error) throw error;
      return mapDocument(data);
    },
    async listByAssessment(assessmentId: string): Promise<DocumentRecord[]> {
      const { data, error } = await client
        .from("documents")
        .select()
        .eq("assessment_id", assessmentId)
        .is("deleted_at", null);
      if (error) throw error;
      return (data ?? []).map(mapDocument);
    },
    async getById(id: string): Promise<DocumentRecord | null> {
      const { data, error } = await client
        .from("documents")
        .select()
        .eq("id", id)
        .maybeSingle();
      if (error) throw error;
      return data ? mapDocument(data) : null;
    },
    async markDeleted(id: string): Promise<void> {
      const { error } = await client
        .from("documents")
        .update({ upload_status: "deleted", deleted_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
  };

  const assessmentSessions: AssessmentSessionRepository = {
    async create(input: NewAssessmentSessionInput): Promise<AssessmentSession> {
      const { data, error } = await client
        .from("assessment_sessions")
        .insert({
          assessment_id: input.assessmentId,
          session_token_hash: input.sessionTokenHash,
          expires_at: input.expiresAt.toISOString(),
        })
        .select()
        .single();
      if (error) throw error;
      return mapAssessmentSession(data);
    },
    async findByTokenHash(sessionTokenHash: string): Promise<AssessmentSession | null> {
      const { data, error } = await client
        .from("assessment_sessions")
        .select()
        .eq("session_token_hash", sessionTokenHash)
        .maybeSingle();
      if (error) throw error;
      return data ? mapAssessmentSession(data) : null;
    },
  };

  const documentExtractions: DocumentExtractionRepository = {
    async create(input: NewDocumentExtractionInput): Promise<DocumentExtraction> {
      const { data, error } = await client
        .from("document_extractions")
        .insert({
          document_id: input.documentId,
          schema_name: input.schemaName,
          schema_version: input.schemaVersion,
          provider: input.provider,
          model: input.model,
          extraction_json: input.extractionJson,
          confidence_json: input.confidenceJson,
          evidence_json: input.evidenceJson,
          status: input.status,
        })
        .select()
        .single();
      if (error) throw error;
      return mapDocumentExtraction(data);
    },
    async listByDocument(documentId: string): Promise<DocumentExtraction[]> {
      const { data, error } = await client
        .from("document_extractions")
        .select()
        .eq("document_id", documentId);
      if (error) throw error;
      return (data ?? []).map(mapDocumentExtraction);
    },
    async listByAssessment(assessmentId: string): Promise<DocumentExtraction[]> {
      const { data, error } = await client
        .from("document_extractions")
        .select("*, documents!inner(assessment_id)")
        .eq("documents.assessment_id", assessmentId);
      if (error) throw error;
      return (data ?? []).map(mapDocumentExtraction);
    },
  };

  const derivedFacts: DerivedFactRepository = {
    async create(input: NewDerivedFactInput): Promise<DerivedFact> {
      const { data, error } = await client
        .from("derived_facts")
        .insert({
          assessment_id: input.assessmentId,
          fact_key: input.factKey,
          value_json: input.valueJson,
          source_type: input.sourceType,
          source_id: input.sourceId ?? null,
          confidence: input.confidence ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return mapDerivedFact(data);
    },
    async listByAssessment(assessmentId: string): Promise<DerivedFact[]> {
      const { data, error } = await client
        .from("derived_facts")
        .select()
        .eq("assessment_id", assessmentId);
      if (error) throw error;
      return (data ?? []).map(mapDerivedFact);
    },
  };

  const ruleEvaluations: RuleEvaluationRepository = {
    async create(input: NewRuleEvaluationInput): Promise<RuleEvaluation> {
      const { data, error } = await client
        .from("rule_evaluations")
        .insert({
          assessment_id: input.assessmentId,
          rule_id: input.ruleId,
          rule_version: input.ruleVersion,
          matched: input.matched,
          input_snapshot: input.inputSnapshot,
          base_severity: input.baseSeverity,
          scope_points: input.scopePoints,
          duration_points: input.durationPoints,
          systemic_points: input.systemicPoints,
          dispute_points: input.disputePoints,
          override_critical: input.overrideCritical,
          risk_score: input.riskScore,
          risk_level: input.riskLevel,
          confidence: input.confidence ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return mapRuleEvaluation(data);
    },
    async listByAssessment(assessmentId: string): Promise<RuleEvaluation[]> {
      const { data, error } = await client
        .from("rule_evaluations")
        .select()
        .eq("assessment_id", assessmentId);
      if (error) throw error;
      return (data ?? []).map(mapRuleEvaluation);
    },
  };

  const findings: FindingRepository = {
    async create(input: NewFindingInput): Promise<Finding> {
      const { data, error } = await client
        .from("findings")
        .insert({
          assessment_id: input.assessmentId,
          rule_evaluation_id: input.ruleEvaluationId ?? null,
          category: input.category,
          sub_category: input.subCategory ?? null,
          internal_title: input.internalTitle,
          client_title: input.clientTitle ?? null,
          draft_internal_text: input.draftInternalText ?? null,
          draft_client_text: input.draftClientText ?? null,
          recommended_action: input.recommendedAction ?? null,
          risk_score: input.riskScore ?? null,
          risk_level: input.riskLevel ?? null,
          confidence: input.confidence ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return mapFinding(data);
    },
    async listByAssessment(assessmentId: string): Promise<Finding[]> {
      const { data, error } = await client
        .from("findings")
        .select()
        .eq("assessment_id", assessmentId);
      if (error) throw error;
      return (data ?? []).map(mapFinding);
    },
    async getById(id: string): Promise<Finding | null> {
      const { data, error } = await client.from("findings").select().eq("id", id).maybeSingle();
      if (error) throw error;
      return data ? mapFinding(data) : null;
    },
    async review(id: string, update: FindingReviewUpdate, reviewedBy: string): Promise<Finding> {
      if (update.severityOverride != null && !update.overrideReason) {
        throw new Error("override_requires_reason");
      }
      const patch: Record<string, unknown> = { reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() };
      if (update.status !== undefined) patch.status = update.status;
      if (update.visibleToClient !== undefined) patch.visible_to_client = update.visibleToClient;
      if (update.lawyerNotes !== undefined) patch.lawyer_notes = update.lawyerNotes;
      if (update.severityOverride !== undefined) patch.severity_override = update.severityOverride;
      if (update.overrideReason !== undefined) patch.override_reason = update.overrideReason;

      const { data, error } = await client
        .from("findings")
        .update(patch)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return mapFinding(data);
    },
  };

  const reports: ReportRepository = {
    async create(input: NewReportInput): Promise<Report> {
      const { data, error } = await client
        .from("reports")
        .insert({
          assessment_id: input.assessmentId,
          report_type: input.reportType,
          version: input.version,
          storage_path: input.storagePath,
          generated_by: input.generatedBy ?? null,
        })
        .select()
        .single();
      if (error) throw error;
      return mapReport(data);
    },
    async listByAssessment(assessmentId: string): Promise<Report[]> {
      const { data, error } = await client
        .from("reports")
        .select()
        .eq("assessment_id", assessmentId);
      if (error) throw error;
      return (data ?? []).map(mapReport);
    },
    async getById(id: string): Promise<Report | null> {
      const { data, error } = await client.from("reports").select().eq("id", id).maybeSingle();
      if (error) throw error;
      return data ? mapReport(data) : null;
    },
  };

  return {
    organizations,
    assessments,
    answers,
    audit,
    documents,
    assessmentSessions,
    documentExtractions,
    derivedFacts,
    ruleEvaluations,
    findings,
    reports,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapOrganization(row: any): Organization {
  return {
    id: row.id,
    legalName: row.legal_name,
    businessType: row.business_type,
    industry: row.industry,
    branchCount: row.branch_count,
    currentEmployeeCount: row.current_employee_count,
    formerEmployeeCount12m: row.former_employee_count_12m,
    freelancerCount: row.freelancer_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapAssessment(row: any): Assessment {
  return {
    id: row.id,
    organizationId: row.organization_id,
    status: row.status,
    assessmentVersion: row.assessment_version,
    questionnaireVersion: row.questionnaire_version,
    ruleEngineVersion: row.rule_engine_version,
    secureTokenHash: row.secure_token_hash,
    tokenExpiresAt: row.token_expires_at,
    submittedAt: row.submitted_at,
    approvedAt: row.approved_at,
    approvedBy: row.approved_by,
    retentionDays: row.retention_days,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDocument(row: any): DocumentRecord {
  return {
    id: row.id,
    assessmentId: row.assessment_id,
    documentType: row.document_type,
    storagePath: row.storage_path,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    uploadStatus: row.upload_status,
    uploadedAt: row.uploaded_at,
    deletedAt: row.deleted_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapAssessmentSession(row: any): AssessmentSession {
  return {
    id: row.id,
    assessmentId: row.assessment_id,
    sessionTokenHash: row.session_token_hash,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapAnswer(row: any): Answer {
  return {
    id: row.id,
    assessmentId: row.assessment_id,
    questionId: row.question_id,
    valueJson: row.value_json,
    source: row.source,
    answeredAt: row.answered_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapAuditEvent(row: any): AuditEvent {
  return {
    id: row.id,
    actorType: row.actor_type,
    actorId: row.actor_id,
    assessmentId: row.assessment_id,
    eventType: row.event_type,
    metadataJson: row.metadata_json,
    createdAt: row.created_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDocumentExtraction(row: any): DocumentExtraction {
  return {
    id: row.id,
    documentId: row.document_id,
    schemaName: row.schema_name,
    schemaVersion: row.schema_version,
    provider: row.provider,
    model: row.model,
    extractionJson: row.extraction_json,
    confidenceJson: row.confidence_json,
    evidenceJson: row.evidence_json,
    status: row.status,
    createdAt: row.created_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapDerivedFact(row: any): DerivedFact {
  return {
    id: row.id,
    assessmentId: row.assessment_id,
    factKey: row.fact_key,
    valueJson: row.value_json,
    sourceType: row.source_type,
    sourceId: row.source_id,
    confidence: row.confidence,
    createdAt: row.created_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapRuleEvaluation(row: any): RuleEvaluation {
  return {
    id: row.id,
    assessmentId: row.assessment_id,
    ruleId: row.rule_id,
    ruleVersion: row.rule_version,
    matched: row.matched,
    inputSnapshot: row.input_snapshot,
    baseSeverity: row.base_severity,
    scopePoints: row.scope_points,
    durationPoints: row.duration_points,
    systemicPoints: row.systemic_points,
    disputePoints: row.dispute_points,
    overrideCritical: row.override_critical,
    riskScore: row.risk_score,
    riskLevel: row.risk_level,
    confidence: row.confidence,
    createdAt: row.created_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapFinding(row: any): Finding {
  return {
    id: row.id,
    assessmentId: row.assessment_id,
    ruleEvaluationId: row.rule_evaluation_id,
    category: row.category,
    subCategory: row.sub_category,
    internalTitle: row.internal_title,
    clientTitle: row.client_title,
    draftInternalText: row.draft_internal_text,
    draftClientText: row.draft_client_text,
    recommendedAction: row.recommended_action,
    riskScore: row.risk_score,
    riskLevel: row.risk_level,
    confidence: row.confidence,
    status: row.status,
    visibleToClient: row.visible_to_client,
    lawyerNotes: row.lawyer_notes,
    severityOverride: row.severity_override,
    overrideReason: row.override_reason,
    reviewedBy: row.reviewed_by,
    reviewedAt: row.reviewed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapReport(row: any): Report {
  return {
    id: row.id,
    assessmentId: row.assessment_id,
    reportType: row.report_type,
    version: row.version,
    storagePath: row.storage_path,
    generatedBy: row.generated_by,
    generatedAt: row.generated_at,
  };
}
