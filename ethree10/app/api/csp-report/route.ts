import { NextResponse } from "next/server";
import { clientIp } from "@/server/security/client-ip";
import { enforcePublicRateLimit } from "@/server/security/public-rate-limit";
import { normalizeReports, summarizeViolation } from "@/lib/csp-report";

/**
 * Where CSP violation reports land.
 *
 * Until now the policy named no reporting endpoint at all, so it was
 * Report-Only *and* reporting nowhere — neither blocking nor observing. This is
 * what makes "review the reports, then enforce" possible.
 *
 * Everything here is written on the assumption that the body is hostile. The
 * endpoint is necessarily unauthenticated — browsers post these with no
 * session, from any page, including pages an attacker controls the content of —
 * so it is a public write surface and is treated as one:
 *
 *   - rate limited per IP, so it cannot be used to flood the logs;
 *   - body size capped before parsing, so it cannot be used to exhaust memory;
 *   - only known fields are read, each truncated, so nothing unbounded or
 *     attacker-shaped reaches the log;
 *   - always answers 204, so a malformed report is never worth probing.
 *
 * Reports go to stdout, which is where the VPS collects application logs. Once
 * SENTRY_DSN is set these are worth routing there instead — a violation is
 * exactly the kind of thing nobody reads a log file to find.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Generous for a real report, far below anything that could hurt. */
const MAX_BODY_BYTES = 16 * 1024;

/** Per IP, per hour. A page in a redirect loop can fire hundreds. */
const REPORTS_PER_HOUR = 60;

export async function POST(request: Request) {
  try {
    await enforcePublicRateLimit({
      action: "csp.report",
      secret: clientIp(request.headers) ?? "unknown",
      limit: REPORTS_PER_HOUR,
      windowSeconds: 3600,
    });
  } catch {
    // Over the limit. Still 204: telling a flooder they are being limited only
    // tells them what to work around, and the browser has nothing to do with
    // the answer either way.
    return new NextResponse(null, { status: 204 });
  }

  try {
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return new NextResponse(null, { status: 204 });

    for (const body of normalizeReports(JSON.parse(raw))) {
      // One line per violation, prefixed so it can be grepped out of the
      // application log without knowing this file exists.
      console.warn("[csp-violation]", JSON.stringify(summarizeViolation(body)));
    }
  } catch {
    // Malformed JSON, wrong content type, truncated body. Nothing to do and
    // nothing worth reporting back — the browser does not read the response.
  }

  return new NextResponse(null, { status: 204 });
}
