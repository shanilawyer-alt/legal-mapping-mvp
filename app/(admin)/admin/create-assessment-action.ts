"use server";

import { getRepositories } from "@/lib/db";
import { createAssessmentWithToken } from "@/domain/assessment/service";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export interface CreateAssessmentState {
  error?: string;
  link?: string;
  organizationName?: string;
}

export async function createAssessmentAction(
  _prevState: CreateAssessmentState,
  formData: FormData,
): Promise<CreateAssessmentState> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "יש להתחבר מחדש." };
  }

  const legalName = String(formData.get("legalName") ?? "").trim();
  if (!legalName) {
    return { error: "יש להזין שם עסק." };
  }

  const repos = getRepositories();
  const organization = await repos.organizations.create({ legalName });
  const { rawToken } = await createAssessmentWithToken(
    repos,
    { organizationId: organization.id },
    user.id,
  );

  // The raw token is returned to the admin exactly once, here. It is not
  // persisted anywhere — only its HMAC digest is stored (spec §5).
  return { link: `/assessment/${rawToken}`, organizationName: legalName };
}
