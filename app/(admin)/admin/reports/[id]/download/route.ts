import { NextResponse, type NextRequest } from "next/server";
import { getRepositories } from "@/lib/db";
import { getDocumentStore } from "@/lib/storage";
import { getAdminUserId } from "@/lib/supabase/server";

/**
 * The only way an admin ever reaches a generated report's HTML bytes —
 * mirrors app/(admin)/admin/documents/[id]/download/route.ts exactly
 * (same private-storage, short-lived-signed-URL, no-public-object
 * discipline, spec §7). `proxy.ts` already gates every `/admin/*`
 * request, but this checks again itself (OPEN_QUESTIONS.md item 15).
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const adminUserId = await getAdminUserId();
  if (!adminUserId) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const repos = getRepositories();
  const report = await repos.reports.getById(id);
  if (!report) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const store = getDocumentStore();
  const url = await store.getSignedDownloadUrl(report.storagePath);
  return NextResponse.redirect(url);
}
