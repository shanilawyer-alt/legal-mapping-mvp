import { NextResponse, type NextRequest } from "next/server";
import { getRepositories } from "@/lib/db";
import { getDocumentStore } from "@/lib/storage";
import { getAdminUserId } from "@/lib/supabase/server";
import { issueSignedDownloadUrlForAdmin } from "@/domain/documents/service";

/**
 * The only way an admin ever reaches a document's bytes (Phase 2 spec
 * item 6). The bucket itself is never public and no storage path is ever
 * sent to the browser directly — this route authenticates the admin,
 * issues a fresh short-lived signed URL server-side
 * (lib/storage/supabaseStorage.ts, 5-minute TTL), audits the access, and
 * redirects to that URL. `proxy.ts` already gates every `/admin/*`
 * request, but this checks again itself (OPEN_QUESTIONS.md item 15).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const adminUserId = await getAdminUserId();
  if (!adminUserId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const repos = getRepositories();
  const store = getDocumentStore();
  const result = await issueSignedDownloadUrlForAdmin(repos, store, id, adminUserId);
  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 404 });
  }

  return NextResponse.redirect(result.url);
}
