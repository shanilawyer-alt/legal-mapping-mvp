import { NextResponse, type NextRequest } from "next/server";
import { getRepositories } from "@/lib/db";
import { getDocumentStore } from "@/lib/storage";
import { uploadDocumentForToken } from "@/domain/documents/service";

/**
 * Token-scoped document upload for the public questionnaire. Multipart
 * body: `token`, `documentType` (a document_analysis_matrix.csv ID, e.g.
 * "DOC-01"), `file`. Never sends file content to an AI provider — see
 * domain/documents/service.ts.
 */
export async function POST(request: NextRequest) {
  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const token = formData.get("token");
  const documentType = formData.get("documentType");
  const file = formData.get("file");

  if (
    typeof token !== "string" ||
    typeof documentType !== "string" ||
    !(file instanceof File)
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const arrayBuffer = await file.arrayBuffer();

  const repos = getRepositories();
  const store = getDocumentStore();

  const result = await uploadDocumentForToken(repos, store, {
    rawToken: token,
    documentType,
    originalFilename: file.name,
    mimeType: file.type || "application/octet-stream",
    data: Buffer.from(arrayBuffer),
  });

  if (!result.ok) {
    const status =
      result.error === "not_found" ? 404 : result.error === "expired" ? 410 : 422;
    return NextResponse.json({ error: result.error, message: result.message }, { status });
  }

  return NextResponse.json({
    document: {
      id: result.document.id,
      documentType: result.document.documentType,
      originalFilename: result.document.originalFilename,
      uploadedAt: result.document.uploadedAt,
    },
  });
}
