import { NextResponse, type NextRequest } from "next/server";
import { getRepositories } from "@/lib/db";
import { createSessionForToken } from "@/domain/assessment/session";
import { ASSESSMENT_SESSION_COOKIE, sessionCookieOptions } from "@/lib/security/sessionCookie";

/**
 * The token-exchange endpoint (Phase 1.1 hardening). This is the ONLY
 * place the raw assessment token is ever read from a URL. On success it
 * mints a short-lived session (domain/assessment/session.ts), sets it as
 * an HttpOnly/Secure/SameSite=Lax cookie, and redirects to the clean,
 * token-free `/assessment` URL — so the token never appears in that page's
 * URL, browser history entry, or any Referer header sent from it.
 *
 * A GET request here is a one-time exchange, not a page render: on
 * failure it redirects to `/assessment?error=...` rather than rendering
 * inline, so there is exactly one place (`/assessment`) that renders the
 * questionnaire UI, whether reached fresh or via a failed exchange.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const repos = getRepositories();
  const result = await createSessionForToken(repos, token);

  const assessmentUrl = new URL("/assessment", request.url);

  if (!result.ok) {
    assessmentUrl.searchParams.set("error", result.error);
    return NextResponse.redirect(assessmentUrl);
  }

  const response = NextResponse.redirect(assessmentUrl);
  response.cookies.set(
    ASSESSMENT_SESSION_COOKIE,
    result.rawSessionToken,
    sessionCookieOptions(result.sessionExpiresAt),
  );
  return response;
}
