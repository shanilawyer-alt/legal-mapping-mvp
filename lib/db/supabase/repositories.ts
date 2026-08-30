import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AnswerRepository,
  AssessmentRepository,
  AuditRepository,
  CreateAssessmentInput,
  DocumentRepository,
  OrganizationRepository,
  Repositories,
} from "@/lib/db/repositories";
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

  return { organizations, assessments, answers, audit, documents };
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
